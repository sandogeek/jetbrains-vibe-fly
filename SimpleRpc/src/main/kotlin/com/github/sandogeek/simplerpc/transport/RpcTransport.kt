package com.github.sandogeek.simplerpc.transport

/**
 * Bidirectional message pipe between Kotlin and a peer (JCEF WebView, Node stdio, …).
 *
 * - [sendToRemote] delivers a wire-format JSON string to the remote peer.
 * - [setIncomingHandler] receives every message originating from the remote peer.
 * - [setCloseHandler] is invoked once when the pipe becomes unusable (EOF, I/O error).
 *   [com.github.sandogeek.simplerpc.RpcSession] uses this to fail pending calls immediately.
 *
 * The handler must be invoked serially and in the order messages arrive on the wire.
 * [com.github.sandogeek.simplerpc.RpcSession] relies on this so a cancel never overtakes
 * the request it targets. [com.github.sandogeek.simplerpc.jcef.CefMessageRouterTransport]
 * and [com.github.sandogeek.simplerpc.stdio.StdioRpcTransport] both guarantee this.
 */
interface RpcTransport {
    fun sendToRemote(message: String)

    fun setIncomingHandler(handler: ((message: String) -> Unit)?)

    /**
     * Optional. Transports that can detect peer disconnect (e.g. stdio EOF) should call
     * [handler] exactly once. Default is a no-op for transports without a natural end
     * (e.g. JCEF while the browser is still open).
     */
    fun setCloseHandler(handler: (() -> Unit)?) {}
}
