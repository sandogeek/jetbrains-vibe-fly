package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

/**
 * Short-lived UI ↔ Agent WebSocket session credentials.
 * Issued by the agent via control-plane [Host2Agent.openWebSocketSession]
 * and delivered to the WebView through [Ui2HostChat.getAgentConnection].
 */
@Serializable
data class AgentConnection(
    val url: String,
    val ticket: String,
    val expiresAtEpochMs: Long,
)
