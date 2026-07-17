package com.github.sandogeek.simplerpc.internal

import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.protocol.JsonCodec
import com.github.sandogeek.simplerpc.protocol.RpcMessage
import java.lang.reflect.Method
import java.util.concurrent.ConcurrentHashMap
import kotlinx.serialization.json.JsonElement

/**
 * Dispatches inbound [RpcMessage.Request] to registered Kotlin implementations.
 * Only [@RpcFun] methods are registered; lookup is by method id only.
 */
internal class RpcDispatcher {

    private data class Registration(
        val instance: Any,
        val methodsById: Map<Int, Method>,
    )

    private val services = ConcurrentHashMap<String, Registration>()

    fun <T : Any> register(iface: Class<T>, impl: T) {
        RpcSuspendRequirement.check(iface)
        val service = ServiceName.of(iface)
        val methodsById = LinkedHashMap<Int, Method>()
        for (method in iface.declaredMethods) {
            if (!SuspendInvoker.isRpcCandidate(method)) continue
            val rpcFun = method.getAnnotation(RpcFun::class.java)!!
            methodsById[rpcFun.id] = method
        }
        services[service] = Registration(impl, methodsById)
    }

    fun unregister(iface: Class<*>) {
        services.remove(ServiceName.of(iface))
    }

    suspend fun dispatch(request: RpcMessage.Request): JsonElement {
        val reg = services[request.service]
            ?: throw NoSuchElementException("Unknown RPC service: ${request.service}")
        val method = reg.methodsById[request.methodId]
            ?: throw NoSuchElementException(
                "Unknown method ${request.service}#${request.methodId}",
            )
        val paramTypes = SuspendInvoker.rpcParameterTypes(method)
        require(request.args.size == paramTypes.size) {
            "Arity mismatch for ${request.service}#${request.methodId}: " +
                "expected ${paramTypes.size}, got ${request.args.size}"
        }
        val args = Array(paramTypes.size) { i ->
            JsonCodec.fromJsonElement(request.args[i], paramTypes[i])
        }
        val result = SuspendInvoker.invoke(reg.instance, method, args)
        return JsonCodec.toJsonElement(result, SuspendInvoker.rpcReturnType(method))
    }
}
