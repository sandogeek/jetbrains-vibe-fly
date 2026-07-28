package com.github.sandogeek.vibefly.jcef.rpc

import com.intellij.openapi.diagnostic.logger

/**
 * Default [Ui2Host] for the tool-window WebView session.
 *
 * [getAgentConnection] is supplied by the plugin (project-level agent service);
 * the jcef module does not own agent lifecycle.
 *
 * Settings RPCs (4–11) default to no-op / empty so chat panels stay lightweight.
 * Settings hosts use [SettingsUi2Host] in the plugin module.
 */
open class Ui2HostImpl(
    private val appVersion: String = DEFAULT_VERSION,
    private val agentConnectionProvider: (suspend () -> AgentConnection?)? = null,
    private val projectRootProvider: () -> String = { "" },
    private val workspaceStateProvider: () -> ChatWorkspaceStateDto = { ChatWorkspaceStateDto() },
    private val workspaceStateSaver: (suspend (ChatWorkspaceStateDto) -> Unit)? = null,
    private val openProjectFileHandler: (suspend (String, Int?) -> Unit)? = null,
    private val refreshProjectFilesHandler: (suspend (List<String>) -> Unit)? = null,
    private val showProjectDiffHandler: (suspend (String) -> Unit)? = null,
    private val selectChatContextFilesHandler: (suspend () -> List<String>)? = null,
    private val chatUiReadyHandler: (suspend () -> Unit)? = null,
) : Ui2Host {

    override suspend fun getAppVersion(): String = appVersion

    override suspend fun logFromWeb(message: String) {
        // Visible in idea.log / Debug Log Settings for this category.
        log.info("WebView: $message")
    }

    override suspend fun getAgentConnection(): AgentConnection? {
        val provider = agentConnectionProvider ?: return null
        return try {
            provider()
        } catch (e: Exception) {
            log.warn("getAgentConnection failed", e)
            null
        }
    }

    override suspend fun getIdeSettings(): IdeSettingsDto = IdeSettingsDto()

    override suspend fun saveIdeSettings(settings: IdeSettingsDto) {
        log.debug("saveIdeSettings ignored on non-settings host")
    }

    override suspend fun refreshProviders(agentDir: String): ProvidersRefreshResult =
        ProvidersRefreshResult(ok = false, error = "Settings host only")

    override suspend fun applyProvidersPatch(request: ProvidersPatchRequest): ProvidersPatchResult =
        ProvidersPatchResult(ok = false, error = "Settings host only")

    override suspend fun loginProvider(request: ProviderLoginRequest): ProviderLoginResult =
        ProviderLoginResult(ok = false, error = "Settings host only")

    override suspend fun cancelProviderLogin() {
        log.debug("cancelProviderLogin ignored on non-settings host")
    }

    override suspend fun logoutProvider(request: ProviderLogoutRequest): ProviderLogoutResult =
        ProviderLogoutResult(ok = false, error = "Settings host only")

    override suspend fun openExternalUrl(url: String) {
        log.debug("openExternalUrl ignored on non-settings host: $url")
    }

    override suspend fun getProjectRoot(): String = projectRootProvider()

    override suspend fun getChatWorkspaceState(): ChatWorkspaceStateDto = workspaceStateProvider()

    override suspend fun saveChatWorkspaceState(state: ChatWorkspaceStateDto) {
        workspaceStateSaver?.invoke(state) ?: log.debug("saveChatWorkspaceState ignored on non-project host")
    }

    override suspend fun openProjectFile(relativePath: String, line: Int?) {
        openProjectFileHandler?.invoke(relativePath, line)
            ?: log.debug("openProjectFile ignored on non-project host: $relativePath")
    }

    override suspend fun refreshProjectFiles(relativePaths: List<String>) {
        refreshProjectFilesHandler?.invoke(relativePaths)
            ?: log.debug("refreshProjectFiles ignored on non-project host")
    }

    override suspend fun showProjectDiff(relativePath: String) {
        showProjectDiffHandler?.invoke(relativePath)
            ?: log.debug("showProjectDiff ignored on non-project host: $relativePath")
    }

    override suspend fun selectChatContextFiles(): List<String> =
        selectChatContextFilesHandler?.invoke().orEmpty()

    override suspend fun chatUiReady() {
        chatUiReadyHandler?.invoke()
    }

    companion object {
        const val DEFAULT_VERSION: String = "0.0.1"
        private val log = logger<Ui2HostImpl>()
    }
}
