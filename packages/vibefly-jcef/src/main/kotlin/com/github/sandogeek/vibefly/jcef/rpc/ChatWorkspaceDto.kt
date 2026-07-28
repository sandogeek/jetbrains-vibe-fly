package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

@Serializable
data class ChatWorkspaceStateDto(
    val sessionIds: List<String> = emptyList(),
    val activeSessionId: String = "",
)

@Serializable
data class HostChatContextItem(
    val id: String,
    val kind: String,
    val path: String,
    val text: String? = null,
    val startLine: Int? = null,
    val endLine: Int? = null,
)
