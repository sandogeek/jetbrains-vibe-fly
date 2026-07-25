package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.RpcFun

/**
 * Host → Agent (Kotlin calls Bun) control plane over stdio SimpleRpc.
 * Lifecycle, session tickets, and short request/response helpers (e.g. commit message).
 * Wire service name: Host2Agent.
 */
@KotlinCallTs
interface Host2Agent {
    @RpcFun(1)
    suspend fun openWebSocketSession(expectedOrigin: String): AgentConnection

    @RpcFun(2)
    suspend fun shutdown()

    @RpcFun(3)
    suspend fun generateCommitMessage(
        request: GenerateCommitMessageRequest,
    ): GenerateCommitMessageResult

    @RpcFun(4)
    suspend fun getProviderCatalog(): ProviderCatalog

    @RpcFun(5)
    suspend fun getProvidersSnapshot(agentDir: String): ProvidersSnapshot

    @RpcFun(6)
    suspend fun applyProvidersPatch(request: ProvidersPatchRequest): ProvidersPatchResult
}
