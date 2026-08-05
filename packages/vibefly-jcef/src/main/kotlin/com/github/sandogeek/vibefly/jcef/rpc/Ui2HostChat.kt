package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin

/**
 * Chat-panel UI → Host methods (tool window only).
 * Wire service name: Ui2HostChat.
 */
@TsCallKotlin
interface Ui2HostChat {
    /**
     * Issue a short-lived Agent WebSocket session.
     * Origin is computed on the Kotlin side from the panel URL; UI cannot supply it.
     * Returns null when the project agent is not ready.
     */
    @RpcFun(1)
    suspend fun getAgentConnection(): AgentConnection?

    /** Canonical project root used by the project-level Agent registry. */
    @RpcFun(2)
    suspend fun getProjectRoot(): String

    /** Workspace-local open tab order and active tab. */
    @RpcFun(3)
    suspend fun getChatWorkspaceState(): ChatWorkspaceStateDto

    @RpcFun(4)
    suspend fun saveChatWorkspaceState(state: ChatWorkspaceStateDto)

    /** Open a project-relative path in the IDE editor. */
    @RpcFun(5)
    suspend fun openProjectFile(relativePath: String, line: Int?)

    /** Refresh VFS after an Agent write. */
    @RpcFun(6)
    suspend fun refreshProjectFiles(relativePaths: List<String>)

    /** Host may choose native VCS diff in a later implementation. */
    @RpcFun(7)
    suspend fun showProjectDiff(relativePath: String)

    /** JetBrains native multi-file chooser. Returns project-relative regular files only. */
    @RpcFun(8)
    suspend fun selectChatContextFiles(): List<String>

    /** Signals that Host → UI context delivery can be retried after page load/reload. */
    @RpcFun(9)
    suspend fun chatUiReady()

    /** Open IDE Settings → Tools → Vibe Fly. */
    @RpcFun(10)
    suspend fun openIdeSettings()
}
