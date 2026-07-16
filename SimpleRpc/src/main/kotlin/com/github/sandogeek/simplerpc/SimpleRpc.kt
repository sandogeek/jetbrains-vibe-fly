package com.github.sandogeek.simplerpc

import com.github.sandogeek.simplerpc.internal.RpcSuspendRequirement

/**
 * Entry point for SimpleRpc — bidirectional bridge between JCEF WebView and Kotlin.
 *
 * Interfaces marked with [com.github.sandogeek.simplerpc.annotation.KotlinCallTs] or
 * [com.github.sandogeek.simplerpc.annotation.TsCallKotlin] must declare only `suspend` methods.
 */
object SimpleRpc {

    /**
     * Validates that [iface] is a SimpleRpc-annotated interface and every method is `suspend`.
     * Call before registering an implementation or creating a proxy.
     */
    fun <T : Any> requireSuspendMethods(iface: Class<T>) {
        RpcSuspendRequirement.check(iface)
    }

    inline fun <reified T : Any> requireSuspendMethods() {
        requireSuspendMethods(T::class.java)
    }
}
