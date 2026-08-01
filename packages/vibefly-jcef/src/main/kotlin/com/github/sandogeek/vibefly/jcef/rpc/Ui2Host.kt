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

    /** Fetch mutable provider state from this IDE product's agent directory. */
    @RpcFun(6)
    suspend fun refreshProviders(): ProvidersRefreshResult

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

    /** Canonical project root used by the project-level Agent registry. */
    @RpcFun(12)
    suspend fun getProjectRoot(): String

    /** Workspace-local open tab order and active tab. */
    @RpcFun(13)
    suspend fun getChatWorkspaceState(): ChatWorkspaceStateDto

    @RpcFun(14)
    suspend fun saveChatWorkspaceState(state: ChatWorkspaceStateDto)

    /** Open a project-relative path in the IDE editor. */
    @RpcFun(15)
    suspend fun openProjectFile(relativePath: String, line: Int?)

    /** Refresh VFS after an Agent write. */
    @RpcFun(16)
    suspend fun refreshProjectFiles(relativePaths: List<String>)

    /** Host may choose native VCS diff in a later implementation. */
    @RpcFun(17)
    suspend fun showProjectDiff(relativePath: String)

    /** JetBrains native multi-file chooser. Returns project-relative regular files only. */
    @RpcFun(18)
    suspend fun selectChatContextFiles(): List<String>

    /** Signals that Host -> UI context delivery can be retried after page load/reload. */
    @RpcFun(19)
    suspend fun chatUiReady()

    /** Open IDE Settings → Tools → Vibe Fly. */
    @RpcFun(20)
    suspend fun openIdeSettings()
}
