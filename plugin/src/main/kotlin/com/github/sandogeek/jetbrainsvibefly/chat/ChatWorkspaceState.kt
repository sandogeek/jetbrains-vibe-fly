package com.github.sandogeek.jetbrainsvibefly.chat

import com.github.sandogeek.vibefly.jcef.rpc.ChatWorkspaceStateDto
import com.intellij.openapi.components.*
import com.intellij.openapi.project.Project
import com.intellij.util.xmlb.annotations.XCollection

/** Project-local state for open chat tabs. Draft text intentionally stays in the UI process. */
@Service(Service.Level.PROJECT)
@State(
    name = "VibeflyChatWorkspace",
    storages = [Storage(StoragePathMacros.WORKSPACE_FILE)],
)
class ChatWorkspaceState : PersistentStateComponent<ChatWorkspaceState> {
    @XCollection(style = XCollection.Style.v2)
    var sessionIds: MutableList<String> = mutableListOf()

    var activeSessionId: String = ""

    override fun getState(): ChatWorkspaceState = this

    override fun loadState(state: ChatWorkspaceState) {
        sessionIds = state.sessionIds.map(String::trim).filter(String::isNotEmpty).distinct().toMutableList()
        activeSessionId = state.activeSessionId.trim().takeIf { it in sessionIds } ?: sessionIds.firstOrNull().orEmpty()
    }

    fun snapshot(): ChatWorkspaceStateDto = ChatWorkspaceStateDto(sessionIds.toList(), activeSessionId)

    fun replace(state: ChatWorkspaceStateDto) {
        sessionIds = state.sessionIds.map(String::trim).filter(String::isNotEmpty).distinct().toMutableList()
        activeSessionId = state.activeSessionId.trim().takeIf { it in sessionIds } ?: sessionIds.firstOrNull().orEmpty()
    }

    companion object {
        fun getInstance(project: Project): ChatWorkspaceState =
            project.getService(ChatWorkspaceState::class.java)
    }
}
