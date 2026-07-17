package com.github.sandogeek.simplerpc.internal

import com.github.sandogeek.simplerpc.RpcRemoteException
import com.github.sandogeek.simplerpc.RpcTimeoutException
import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.protocol.JsonCodec
import com.github.sandogeek.simplerpc.protocol.RpcMessage
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Method
import java.lang.reflect.Proxy
import java.lang.reflect.Type
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.Continuation
import kotlin.coroutines.intrinsics.COROUTINE_SUSPENDED
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.startCoroutine
import kotlin.time.Duration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine

/** Pending outbound call awaiting a response. */
internal class PendingCall(
    val continuation: Continuation<Any?>,
    val returnType: Type,
) {
    private val completed = AtomicBoolean(false)
    @Volatile var timeoutJob: Job? = null

    fun complete(response: RpcMessage.Response): Boolean {
        if (!completed.compareAndSet(false, true)) return false
        timeoutJob?.cancel()
        when (response) {
            is RpcMessage.Response.Success -> {
                try {
                    val value = when {
                        JsonCodec.isUnitType(returnType) -> Unit
                        else -> JsonCodec.fromJsonElement(response.result, returnType)
                    }
                    continuation.resume(value)
                } catch (e: Exception) {
                    continuation.resumeWithException(
                        RpcRemoteException(
                            "Failed to decode RPC result: ${e.message ?: e::class.java.name}",
                        ),
                    )
                }
            }
            is RpcMessage.Response.Failure -> {
                continuation.resumeWithException(
                    RpcRemoteException(response.error.ifEmpty { "RPC failed" }),
                )
            }
        }
        return true
    }

    fun fail(error: Throwable): Boolean {
        if (!completed.compareAndSet(false, true)) return false
        timeoutJob?.cancel()
        continuation.resumeWithException(error)
        return true
    }

    /**
     * Mark completed without resuming. Used when [suspendCancellableCoroutine]
     * already handles cancellation of the continuation.
     */
    fun abandon(): Boolean {
        if (!completed.compareAndSet(false, true)) return false
        timeoutJob?.cancel()
        return true
    }
}

/**
 * Creates a dynamic proxy for a `@KotlinCallTs` interface.
 */
internal object KotlinCallTsProxy {

    fun <T : Any> create(
        iface: Class<T>,
        send: (RpcMessage.Request) -> Unit,
        sendCancel: (requestId: String) -> Unit,
        pending: ConcurrentHashMap<String, PendingCall>,
        scope: CoroutineScope,
        requestTimeout: Duration,
    ): T {
        RpcSuspendRequirement.check(iface)
        val service = ServiceName.of(iface)
        val handler = TypedProxyHandler(
            service,
            send,
            sendCancel,
            pending,
            scope,
            requestTimeout,
        )
        @Suppress("UNCHECKED_CAST")
        return Proxy.newProxyInstance(
            iface.classLoader,
            arrayOf(iface),
            handler,
        ) as T
    }
}

internal class TypedProxyHandler(
    private val service: String,
    private val send: (RpcMessage.Request) -> Unit,
    private val sendCancel: (requestId: String) -> Unit,
    private val pending: ConcurrentHashMap<String, PendingCall>,
    private val scope: CoroutineScope,
    private val requestTimeout: Duration,
) : InvocationHandler {

    override fun invoke(proxy: Any, method: Method, args: Array<out Any>?): Any? {
        when (method.name) {
            "equals" -> return proxy === args?.getOrNull(0)
            "hashCode" -> return System.identityHashCode(proxy)
            "toString" -> return "SimpleRpcProxy($service)"
        }
        if (!SuspendInvoker.isRpcCandidate(method)) {
            throw UnsupportedOperationException(
                "Not an RPC method (missing @RpcFun): ${method.name}",
            )
        }
        val params = args ?: emptyArray()
        @Suppress("UNCHECKED_CAST")
        val cont = params.last() as Continuation<Any?>
        val rpcArgs = params.dropLast(1)
        val paramTypes = SuspendInvoker.rpcParameterTypes(method)
        val id = UUID.randomUUID().toString()
        val jsonArgs = rpcArgs.mapIndexed { i, arg ->
            JsonCodec.toJsonElement(arg, paramTypes[i])
        }
        val methodId = method.getAnnotation(RpcFun::class.java)!!.id
        val request = RpcMessage.Request(
            id = id,
            service = service,
            methodId = methodId,
            args = jsonArgs,
        )
        val returnType = SuspendInvoker.rpcReturnType(method)

        // Bridge into suspendCancellableCoroutine so Job.cancel() is prompt
        // (raw Continuation from the dynamic proxy is not cancellable until resumed).
        val block: suspend () -> Any? = {
            suspendCancellableCoroutine { cancellable ->
                val call = PendingCall(cancellable, returnType)
                pending[id] = call

                if (requestTimeout.isPositive() && requestTimeout.isFinite()) {
                    call.timeoutJob = scope.launch {
                        delay(requestTimeout)
                        val removed = pending.remove(id) ?: return@launch
                        sendCancel(id)
                        removed.fail(
                            RpcTimeoutException(
                                "RPC timed out after $requestTimeout ($service#$methodId)",
                                requestId = id,
                            ),
                        )
                    }
                }

                cancellable.invokeOnCancellation {
                    val removed = pending.remove(id)
                    if (removed != null && removed.abandon()) {
                        sendCancel(id)
                    }
                }

                send(request)
            }
        }
        block.startCoroutine(cont)
        return COROUTINE_SUSPENDED
    }
}
