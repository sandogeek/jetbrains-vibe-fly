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

    @RpcFun(5)
    suspend fun getProvidersSnapshot(agentDir: String): ProvidersSnapshot

    @RpcFun(6)
    suspend fun applyProvidersPatch(request: ProvidersPatchRequest): ProvidersPatchResult

    /** OAuth / API-key login providers from Oh My Pi registry (same as `/login`). */
    @RpcFun(7)
    suspend fun getLoginProviders(agentDir: String): LoginProvidersList

    /**
     * Interactive provider login via AuthStorage.login (browser OAuth or paste API key).
     * Agent calls [Agent2Host] callbacks while this request is in flight.
     */
    @RpcFun(8)
    suspend fun loginProvider(request: ProviderLoginRequest): ProviderLoginResult

    /** Remove all stored credentials for a provider (API key + OAuth). */
    @RpcFun(9)
    suspend fun logoutProvider(request: ProviderLogoutRequest): ProviderLogoutResult

    /** Abort in-flight [loginProvider] (dialog cancel). */
    @RpcFun(10)
    suspend fun cancelProviderLogin()
}
