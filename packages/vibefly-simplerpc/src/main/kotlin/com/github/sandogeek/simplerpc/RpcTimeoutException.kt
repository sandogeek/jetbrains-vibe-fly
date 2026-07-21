package com.github.sandogeek.simplerpc

/** Thrown when an outbound RPC call exceeds the configured request timeout. */
class RpcTimeoutException(
    message: String,
    val requestId: String? = null,
) : RuntimeException(message)
