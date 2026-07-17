package com.github.sandogeek.simplerpc

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin
import com.github.sandogeek.simplerpc.internal.KotlinCallTsProxy
import com.github.sandogeek.simplerpc.internal.PendingCall
import com.github.sandogeek.simplerpc.internal.RpcDispatcher
import com.github.sandogeek.simplerpc.protocol.RpcMessage
import com.github.sandogeek.simplerpc.transport.RpcTransport
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Bidirectional RPC session over an [RpcTransport] (typically backed by CefMessageRouter).
 *
 * - Register Kotlin implementations of `@TsCallKotlin` interfaces via [register].
 * - Obtain proxies for `@KotlinCallTs` interfaces via [proxy].
 * - Outbound calls fail with [RpcTimeoutException] after [requestTimeout] (default 30s).
 * - Local [Job] cancellation sends a wire cancel; peer cancel aborts inbound dispatch.
 */
class RpcSession(
    private val transport: RpcTransport,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    private val requestTimeout: Duration = DEFAULT_REQUEST_TIMEOUT,
) {
    private val dispatcher = RpcDispatcher()
    private val pending = ConcurrentHashMap<String, PendingCall>()
    private val proxyCache = ConcurrentHashMap<Class<*>, Any>()
    private val inboundJobs = ConcurrentHashMap<String, Job>()

    init {
        transport.setIncomingHandler { raw -> onIncoming(raw) }
    }

    /**
     * Registers a Kotlin implementation for a `@TsCallKotlin` interface.
     * TypeScript can then invoke its methods through the bridge.
     */
    fun <T : Any> register(iface: Class<T>, impl: T) {
        require(iface.isAnnotationPresent(TsCallKotlin::class.java)) {
            "Interface ${iface.name} must be annotated with @TsCallKotlin to register an implementation"
        }
        dispatcher.register(iface, impl)
    }

    /**
     * Registers [impl] against the single `@TsCallKotlin` interface it implements.
     * Throws if none or more than one are found; use [register] with an explicit
     * interface class when the implementation type is ambiguous.
     */
    fun registerImplementation(impl: Any) {
        val ifaces = impl.javaClass.interfaces.filter {
            it.isAnnotationPresent(TsCallKotlin::class.java)
        }
        when (ifaces.size) {
            0 -> throw IllegalArgumentException(
                "No @TsCallKotlin interface found on ${impl.javaClass.name}",
            )
            1 -> {
                @Suppress("UNCHECKED_CAST")
                register(ifaces[0] as Class<Any>, impl)
            }
            else -> throw IllegalArgumentException(
                "Multiple @TsCallKotlin interfaces on ${impl.javaClass.name}: " +
                    ifaces.joinToString { it.name } +
                    ". Use register(iface, impl) with an explicit interface.",
            )
        }
    }

    inline fun <reified T : Any> register(impl: T) = register(T::class.java, impl)

    fun unregister(iface: Class<*>) {
        dispatcher.unregister(iface)
    }

    /**
     * Returns a proxy for a `@KotlinCallTs` interface. Calls are sent to TypeScript
     * and suspend until a response arrives, the call times out, or the caller Job is cancelled.
     */
    fun <T : Any> proxy(iface: Class<T>): T {
        require(iface.isAnnotationPresent(KotlinCallTs::class.java)) {
            "Interface ${iface.name} must be annotated with @KotlinCallTs to create a proxy"
        }
        @Suppress("UNCHECKED_CAST")
        return proxyCache.computeIfAbsent(iface) {
            KotlinCallTsProxy.create(
                iface,
                ::sendRequest,
                ::sendCancel,
                pending,
                scope,
                requestTimeout,
            )
        } as T
    }

    inline fun <reified T : Any> proxy(): T = proxy(T::class.java)

    fun close() {
        transport.setIncomingHandler(null)
        inboundJobs.values.forEach { it.cancel() }
        inboundJobs.clear()
        pending.values.forEach { call ->
            call.fail(RpcRemoteException("RpcSession closed"))
        }
        pending.clear()
        proxyCache.clear()
        scope.cancel()
    }

    private fun sendRequest(request: RpcMessage.Request) {
        transport.sendToRemote(request.toJson())
    }

    private fun sendCancel(requestId: String) {
        transport.sendToRemote(RpcMessage.Cancel(requestId).toJson())
    }

    private fun onIncoming(raw: String) {
        val message = try {
            RpcMessage.parse(raw)
        } catch (e: Exception) {
            val requestId = extractMessageId(raw)
            System.err.println(
                "SimpleRpc: failed to parse incoming message" +
                    (if (requestId != null) " (id=$requestId)" else "") +
                    ": ${e.message}",
            )
            if (requestId != null) {
                val call = pending.remove(requestId)
                if (call != null) {
                    call.fail(
                        RpcRemoteException(
                            "Failed to parse RPC response: ${e.message ?: e::class.java.name}",
                        ),
                    )
                } else {
                    // Best-effort: peer may be waiting on a request we cannot fully parse.
                    try {
                        transport.sendToRemote(
                            RpcMessage.Response(
                                requestId,
                                ok = false,
                                error = "Failed to parse RPC message: ${e.message ?: e::class.java.name}",
                            ).toJson(),
                        )
                    } catch (_: Exception) {
                        // ignore secondary send failures
                    }
                }
            }
            return
        }
        when (message) {
            is RpcMessage.Response -> {
                val call = pending.remove(message.id) ?: return
                call.complete(message)
            }
            is RpcMessage.Cancel -> {
                // Peer cancelled a request we made (unusual) or is aborting; fail local waiters.
                pending.remove(message.id)?.fail(
                    CancellationException("RPC cancelled by peer"),
                )
                // Transport delivers messages in order per session, so the inbound Job
                // is already registered by the time its cancel arrives.
                inboundJobs.remove(message.id)?.cancel()
            }
            is RpcMessage.Request -> {
                val job = scope.launch {
                    try {
                        val result = dispatcher.dispatch(message)
                        if (!isActive) return@launch
                        transport.sendToRemote(
                            RpcMessage.Response(message.id, ok = true, result = result).toJson(),
                        )
                    } catch (_: CancellationException) {
                        // Peer cancelled or session closed; do not send a response.
                    } catch (e: Throwable) {
                        if (!isActive) return@launch
                        transport.sendToRemote(
                            RpcMessage.Response(
                                message.id,
                                ok = false,
                                error = e.message ?: e::class.java.name,
                            ).toJson(),
                        )
                    } finally {
                        inboundJobs.remove(message.id)
                    }
                }
                inboundJobs[message.id] = job
            }
        }
    }

    companion object {
        val DEFAULT_REQUEST_TIMEOUT: Duration = 30.seconds

        /** Best-effort id extraction when full parse fails. */
        private fun extractMessageId(raw: String): String? {
            val match = MESSAGE_ID_REGEX.find(raw) ?: return null
            return match.groupValues[1]
        }

        private val MESSAGE_ID_REGEX =
            Regex(""""id"\s*:\s*"((?:\\.|[^"\\])*)"""")
    }
}
