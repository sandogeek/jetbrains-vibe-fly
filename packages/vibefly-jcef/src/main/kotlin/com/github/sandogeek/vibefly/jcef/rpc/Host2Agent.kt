package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.RpcFun

/**
 * Host → Agent (Kotlin calls Bun) control plane over stdio SimpleRpc.
 * Lifecycle and session tickets only; no UI business frames.
 * Wire service name: Host2Agent.
 */
@KotlinCallTs
interface Host2Agent {
    @RpcFun(1)
    suspend fun openWebSocketSession(expectedOrigin: String): AgentConnection

    @RpcFun(2)
    suspend fun shutdown()
}
