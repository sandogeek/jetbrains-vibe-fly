package com.github.sandogeek.simplerpc.annotation

/**
 * Marks an RPC interface whose implementation lives on the Kotlin/JVM side.
 * TypeScript invokes methods; the call is dispatched to the registered Kotlin implementation.
 * Each RPC entry point must be annotated with [RpcFun] and be `suspend`.
 * Ordinary methods without [RpcFun] are allowed and ignored by SimpleRpc.
 *
 * @param value Optional service name used on the wire. Defaults to the simple class name.
 */
@MustBeDocumented
@Retention(AnnotationRetention.RUNTIME)
@Target(AnnotationTarget.CLASS)
annotation class TsCallKotlin(val value: String = "")
