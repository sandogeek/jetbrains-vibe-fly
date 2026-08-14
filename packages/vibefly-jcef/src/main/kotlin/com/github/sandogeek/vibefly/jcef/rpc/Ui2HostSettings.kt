package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin

/**
 * Settings-panel UI → Host methods (settings editor tab).
 * Wire service name: Ui2HostSettings.
 */
@TsCallKotlin
interface Ui2HostSettings {
    /** Fetch mutable provider state from this IDE product's agent directory. */
    @RpcFun(1)
    suspend fun refreshProviders(): ProvidersRefreshResult

    @RpcFun(2)
    suspend fun applyProvidersPatch(
        request: ProvidersPatchRequest,
        expectedRevision: String,
    ): ProvidersPatchResult

    @RpcFun(3)
    suspend fun loginProvider(request: ProviderLoginRequest): ProviderLoginResult

    @RpcFun(4)
    suspend fun cancelProviderLogin()

    @RpcFun(5)
    suspend fun logoutProvider(request: ProviderLogoutRequest): ProviderLogoutResult

    /** Set or replace an API key through the Agent credential store. */
    @RpcFun(6)
    suspend fun setProviderApiKey(request: ProviderApiKeyRequest): ProvidersPatchResult

    /** Atomically create, update, or delete a custom provider and optional API key. */
    @RpcFun(7)
    suspend fun mutateCustomProvider(
        request: CustomProviderMutationRequest,
        expectedRevision: String,
    ): ProvidersPatchResult
}
