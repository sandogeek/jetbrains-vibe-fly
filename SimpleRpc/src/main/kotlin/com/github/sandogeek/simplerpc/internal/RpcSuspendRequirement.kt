package com.github.sandogeek.simplerpc.internal

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import kotlin.coroutines.Continuation

/**
 * Validates SimpleRpc interface contracts:
 * - only [@RpcFun] methods are RPC entry points (must be `suspend`);
 * - ordinary methods without [@RpcFun] are allowed;
 * - [@RpcFun] ids must be unique within the interface.
 */
internal object RpcSuspendRequirement {

    fun check(iface: Class<*>) {
        require(iface.isInterface) {
            "SimpleRpc type ${iface.name} must be an interface"
        }
        require(
            iface.isAnnotationPresent(KotlinCallTs::class.java) ||
                iface.isAnnotationPresent(TsCallKotlin::class.java),
        ) {
            "Interface ${iface.name} must be annotated with @KotlinCallTs or @TsCallKotlin"
        }

        val rpcMethods = iface.declaredMethods
            .asSequence()
            .filter { isRpcCandidate(it) }
            .toList()

        require(rpcMethods.isNotEmpty()) {
            "RPC interface ${iface.name} must declare at least one @RpcFun method"
        }

        val nonSuspend = rpcMethods
            .asSequence()
            .filterNot { isSuspendMethod(it) }
            .map { it.name }
            .distinct()
            .toList()

        require(nonSuspend.isEmpty()) {
            "RPC methods on ${iface.name} must be suspend; non-suspend: ${nonSuspend.joinToString()}"
        }

        checkRpcFunIds(iface, rpcMethods)
    }

    private fun checkRpcFunIds(iface: Class<*>, rpcMethods: List<Method>) {
        val byId = LinkedHashMap<Int, Method>()
        for (method in rpcMethods) {
            val rpcFun = method.getAnnotation(RpcFun::class.java)!!
            val prev = byId.put(rpcFun.id, method)
            require(prev == null) {
                "RPC interface ${iface.name} has duplicate @RpcFun(id=${rpcFun.id}) " +
                    "on ${prev!!.name} and ${method.name}"
            }
        }
    }

    /** True when [method] is an RPC entry point (has [@RpcFun], not synthetic/bridge/static). */
    fun isRpcCandidate(method: Method): Boolean {
        if (method.isSynthetic || method.isBridge) return false
        if (Modifier.isStatic(method.modifiers)) return false
        if (method.declaringClass == Any::class.java) return false
        if (method.name in IGNORED_NAMES) return false
        return method.isAnnotationPresent(RpcFun::class.java)
    }

    private fun isSuspendMethod(method: Method): Boolean {
        val params = method.parameterTypes
        return params.isNotEmpty() && Continuation::class.java.isAssignableFrom(params.last())
    }

    private val IGNORED_NAMES = setOf("equals", "hashCode", "toString")
}
