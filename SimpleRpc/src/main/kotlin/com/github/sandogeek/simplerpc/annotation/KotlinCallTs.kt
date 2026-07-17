package com.github.sandogeek.simplerpc.annotation

/**
 * Marks an RPC interface whose implementation lives on the TypeScript side.
 * Kotlin obtains a proxy and invokes methods; the call is dispatched to TS (e.g. JCEF WebView).
 * Each RPC entry point must be annotated with [RpcFun] and be `suspend`.
 * Ordinary methods without [RpcFun] are allowed and ignored by SimpleRpc.
 *
 * @param value Optional service name used on the wire. Defaults to the simple class name.
 */
@MustBeDocumented
@Retention(AnnotationRetention.RUNTIME)
@Target(AnnotationTarget.CLASS)
annotation class KotlinCallTs(val value: String = "")
