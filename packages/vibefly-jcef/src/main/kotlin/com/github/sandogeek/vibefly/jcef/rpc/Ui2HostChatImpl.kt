package com.github.sandogeek.vibefly.jcef.rpc

import com.intellij.openapi.diagnostic.logger
import kotlin.coroutines.cancellation.CancellationException

/**
 * Default [Ui2HostChat] for the tool-window WebView.
 *
 * [getAgentConnection] and project handlers are supplied by the plugin module.
 */
class Ui2HostChatImpl(
    private val agentConnectionProvider: (suspend () -> AgentConnection?)? = null,
    private val projectRootProvider: () -> String = { "" },
    private val workspaceStateProvider: () -> ChatWorkspaceStateDto = { ChatWorkspaceStateDto() },
    private val workspaceStateSaver: (suspend (ChatWorkspaceStateDto) -> Unit)? = null,
    private val openProjectFileHandler: (suspend (String, Int?) -> Unit)? = null,
    private val refreshProjectFilesHandler: (suspend (List<String>) -> Unit)? = null,
    private val showProjectDiffHandler: (suspend (String) -> Unit)? = null,
    private val selectChatContextFilesHandler: (suspend () -> List<String>)? = null,
    private val chatUiReadyHandler: (suspend () -> Unit)? = null,
    private val openIdeSettingsHandler: (suspend () -> Unit)? = null,
) : Ui2HostChat {

    override suspend fun getAgentConnection(): AgentConnection? {
        val provider = agentConnectionProvider ?: return null
        return try {
            provider()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.warn("getAgentConnection failed", e)
            null
        }
    }

    override suspend fun getProjectRoot(): String = projectRootProvider()

    override suspend fun getChatWorkspaceState(): ChatWorkspaceStateDto = workspaceStateProvider()

    override suspend fun saveChatWorkspaceState(state: ChatWorkspaceStateDto) {
        workspaceStateSaver?.invoke(state)
            ?: log.debug("saveChatWorkspaceState ignored (no saver)")
    }

    override suspend fun openProjectFile(relativePath: String, line: Int?) {
        openProjectFileHandler?.invoke(relativePath, line)
            ?: log.debug("openProjectFile ignored: $relativePath")
    }

    override suspend fun refreshProjectFiles(relativePaths: List<String>) {
        refreshProjectFilesHandler?.invoke(relativePaths)
            ?: log.debug("refreshProjectFiles ignored")
    }

    override suspend fun showProjectDiff(relativePath: String) {
        showProjectDiffHandler?.invoke(relativePath)
            ?: log.debug("showProjectDiff ignored: $relativePath")
    }

    override suspend fun selectChatContextFiles(): List<String> =
        selectChatContextFilesHandler?.invoke().orEmpty()

    override suspend fun chatUiReady() {
        chatUiReadyHandler?.invoke()
    }

    override suspend fun openIdeSettings() {
        openIdeSettingsHandler?.invoke()
            ?: log.debug("openIdeSettings ignored")
    }

    companion object {
        private val log = logger<Ui2HostChatImpl>()
    }
}
