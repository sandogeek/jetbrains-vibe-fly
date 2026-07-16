package com.github.sandogeek.simplerpc.annotation

/**
 * Marks an RPC interface whose implementation lives on the TypeScript side.
 * Kotlin obtains a proxy and invokes methods; the call is dispatched to TS (e.g. JCEF WebView).
 * All interface methods must be `suspend` (enforced by [com.github.sandogeek.simplerpc.SimpleRpc.requireSuspendMethods]).
 *
 * @param value Optional service name used on the wire. Defaults to the simple class name.
 */
@MustBeDocumented
@Retention(AnnotationRetention.RUNTIME)
@Target(AnnotationTarget.CLASS)
annotation class KotlinCallTs(val value: String = "")
