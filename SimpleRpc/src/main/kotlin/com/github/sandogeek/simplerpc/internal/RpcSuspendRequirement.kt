package com.github.sandogeek.simplerpc.internal

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import kotlin.coroutines.Continuation

/**
 * Enforces that every method on a SimpleRpc-annotated interface is `suspend`.
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

        val nonSuspend = iface.declaredMethods
            .asSequence()
            .filter { isRpcCandidate(it) }
            .filterNot { isSuspendMethod(it) }
            .map { it.name }
            .distinct()
            .toList()

        require(nonSuspend.isEmpty()) {
            "RPC interface ${iface.name} methods must be suspend; non-suspend: ${nonSuspend.joinToString()}"
        }
    }

    private fun isRpcCandidate(method: Method): Boolean {
        if (method.isSynthetic || method.isBridge) return false
        if (Modifier.isStatic(method.modifiers)) return false
        if (method.declaringClass == Any::class.java) return false
        return method.name !in IGNORED_NAMES
    }

    private fun isSuspendMethod(method: Method): Boolean {
        val params = method.parameterTypes
        return params.isNotEmpty() && Continuation::class.java.isAssignableFrom(params.last())
    }

    private val IGNORED_NAMES = setOf("equals", "hashCode", "toString")
}
