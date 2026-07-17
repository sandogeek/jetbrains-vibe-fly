package com.github.sandogeek.simplerpc.transport

/**
 * In-memory transport that pairs two endpoints for tests (simulates CefMessageRouter duplex).
 */
class LoopbackTransport {
    private val a = Endpoint()
    private val b = Endpoint()

    init {
        a.peer = b
        b.peer = a
    }

    fun endpointA(): RpcTransport = a
    fun endpointB(): RpcTransport = b

    private class Endpoint : RpcTransport {
        var peer: Endpoint? = null
        private var handler: ((String) -> Unit)? = null

        override fun sendToRemote(message: String) {
            peer?.handler?.invoke(message)
        }

        override fun setIncomingHandler(handler: ((message: String) -> Unit)?) {
            this.handler = handler
        }
    }
}
