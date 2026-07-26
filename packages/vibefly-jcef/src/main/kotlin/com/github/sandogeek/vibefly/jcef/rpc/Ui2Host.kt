package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin

/**
 * UI → Host (WebView calls Kotlin) over SimpleRpc / CefMessageRouter.
 * Wire service name: Ui2Host.
 */
@TsCallKotlin
interface Ui2Host {
    @RpcFun(1)
    suspend fun getAppVersion(): String

    @RpcFun(2)
    suspend fun logFromWeb(message: String)

    /**
     * Issue a short-lived Agent WebSocket session.
     * Origin is computed on the Kotlin side from the panel URL; UI cannot supply it.
     * Returns null when the project agent is not ready.
     */
    @RpcFun(3)
    suspend fun getAgentConnection(): AgentConnection?

    /** Read IDE PersistentState snapshot (forms + pin/MRU). No catalog / display names. */
    @RpcFun(4)
    suspend fun getIdeSettings(): IdeSettingsDto

    /**
     * Write full IDE settings DTO (providers + commit + model preferences).
     * Host replaces pin/MRU lists wholesale; may stop agents when provider form changes.
     */
    @RpcFun(5)
    suspend fun saveIdeSettings(settings: IdeSettingsDto)

    /** Fetch providers snapshot for [agentDir] (empty → resolved default agent dir). */
    @RpcFun(6)
    suspend fun refreshProviders(agentDir: String): ProvidersRefreshResult

    @RpcFun(7)
    suspend fun applyProvidersPatch(request: ProvidersPatchRequest): ProvidersPatchResult

    @RpcFun(8)
    suspend fun loginProvider(request: ProviderLoginRequest): ProviderLoginResult

    @RpcFun(9)
    suspend fun cancelProviderLogin()

    @RpcFun(10)
    suspend fun logoutProvider(request: ProviderLogoutRequest): ProviderLogoutResult

    @RpcFun(11)
    suspend fun openExternalUrl(url: String)
}
