package com.github.sandogeek.simplerpc

import com.github.sandogeek.simplerpc.internal.RpcSuspendRequirement
import com.github.sandogeek.simplerpc.jcef.CefMessageRouterTransport
import com.github.sandogeek.simplerpc.transport.RpcTransport
import kotlin.time.Duration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Entry point for SimpleRpc — bidirectional RPC over a pluggable [RpcTransport].
 *
 * Interfaces marked with [com.github.sandogeek.simplerpc.annotation.KotlinCallTs] or
 * [com.github.sandogeek.simplerpc.annotation.TsCallKotlin] expose RPC methods via
 * [com.github.sandogeek.simplerpc.annotation.RpcFun] (`suspend` only); other methods may be ordinary.
 *
 * Transports:
 * - [CefMessageRouterTransport] — JCEF WebView (`createCefSimpleRpc` on TS)
 * - [com.github.sandogeek.simplerpc.stdio.StdioRpcTransport] — process stdio with
 *   Content-Length framing (`createStdioSimpleRpc` on Node)
 */
object SimpleRpc {

    /**
     * Validates that [iface] is a SimpleRpc-annotated interface, every [@RpcFun] method is
     * `suspend`, ids are unique, and at least one RPC method exists.
     * Call before registering an implementation or creating a proxy.
     */
    fun <T : Any> requireSuspendMethods(iface: Class<T>) {
        RpcSuspendRequirement.check(iface)
    }

    inline fun <reified T : Any> requireSuspendMethods() {
        requireSuspendMethods(T::class.java)
    }

    /**
     * Opens a bidirectional session on [transport].
     *
     * [requestTimeout] bounds outbound Kotlin → TS calls (default 30s). Use
     * [Duration.INFINITE] to disable. Local Job cancellation and peer cancel messages
     * abort in-flight work on both sides.
     *
     * For JCEF:
     * ```
     * val transport = CefMessageRouterTransport { script ->
     *     browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
     * }
     * val session = SimpleRpc.open(transport)
     * ```
     */
    fun open(
        transport: RpcTransport,
        scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
        requestTimeout: Duration = RpcSession.DEFAULT_REQUEST_TIMEOUT,
    ): RpcSession = RpcSession(transport, scope, requestTimeout)
}
