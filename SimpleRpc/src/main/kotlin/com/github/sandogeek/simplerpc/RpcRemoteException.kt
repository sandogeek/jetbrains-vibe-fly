package com.github.sandogeek.simplerpc

/** Thrown when a remote RPC call fails (wire type `err`). */
class RpcRemoteException(message: String) : RuntimeException(message)
