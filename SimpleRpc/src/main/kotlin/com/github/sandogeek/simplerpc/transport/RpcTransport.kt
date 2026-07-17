package com.github.sandogeek.simplerpc.transport

/**
 * Bidirectional message pipe between Kotlin and the JS side (CefMessageRouter / executeJavaScript).
 *
 * - [sendToRemote] delivers a wire-format JSON string to TypeScript.
 * - [setIncomingHandler] receives every message originating from TypeScript.
 *
 * The handler must be invoked serially and in the order messages arrive on the wire.
 * [com.github.sandogeek.simplerpc.RpcSession] relies on this so a cancel never overtakes
 * the request it targets. CefMessageRouter satisfies it (callbacks fire on the UI thread).
 */
interface RpcTransport {
    fun sendToRemote(message: String)

    fun setIncomingHandler(handler: ((message: String) -> Unit)?)
}
