package com.github.sandogeek.vibefly.jcef.rpc

import com.intellij.openapi.diagnostic.logger

/**
 * Default [Ui2Host] for the tool-window WebView session.
 *
 * [getAgentConnection] is supplied by the plugin (project-level agent service);
 * the jcef module does not own agent lifecycle.
 */
class Ui2HostImpl(
    private val appVersion: String = DEFAULT_VERSION,
    private val agentConnectionProvider: (suspend () -> AgentConnection?)? = null,
) : Ui2Host {

    override suspend fun getAppVersion(): String = appVersion

    override suspend fun logFromWeb(message: String) {
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

    companion object {
        const val DEFAULT_VERSION: String = "0.0.1"
        private val log = logger<Ui2HostImpl>()
    }
}
