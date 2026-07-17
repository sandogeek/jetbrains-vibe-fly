package com.github.sandogeek.simplerpc

/** Thrown when a remote RPC call fails (ok=false on the wire). */
class RpcRemoteException(message: String) : RuntimeException(message)
