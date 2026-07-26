package com.github.sandogeek.jetbrainsvibefly.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil
import java.nio.file.Path

/**
 * Application-level Vibe Fly provider settings.
 * API keys are never stored here — only agentDir and default model selection.
 */
@Service(Service.Level.APP)
@State(
    name = "VibeflyProviderSettings",
    storages = [Storage("vibefly-providers.xml")],
)
class VibeflyProviderSettingsState : PersistentStateComponent<VibeflyProviderSettingsState> {

    /** Oh My Pi agent directory (models.yml + agent.db). Empty = ~/.omp/agent */
    var agentDir: String = ""

    /** Default provider id (e.g. openai). */
    var defaultProvider: String = ""

    /** Default model id within [defaultProvider]. */
    var defaultModel: String = ""

    override fun getState(): VibeflyProviderSettingsState = this

    override fun loadState(state: VibeflyProviderSettingsState) {
        XmlSerializerUtil.copyBean(state, this)
    }

    fun resolvedAgentDir(): String {
        val raw = agentDir.trim()
        if (raw.isNotEmpty()) {
            return expandHome(raw)
        }
        return defaultAgentDir()
    }

    fun defaultModelSpec(): String {
        val p = defaultProvider.trim()
        val m = defaultModel.trim()
        if (p.isEmpty() || m.isEmpty()) return ""
        return "$p/$m"
    }

    fun copyFrom(other: VibeflyProviderSettingsState) {
        agentDir = other.agentDir
        defaultProvider = other.defaultProvider
        defaultModel = other.defaultModel
    }

    fun snapshot(): VibeflyProviderSettingsState {
        val copy = VibeflyProviderSettingsState()
        copy.copyFrom(this)
        return copy
    }

    companion object {
        fun getInstance(): VibeflyProviderSettingsState =
            ApplicationManager.getApplication().getService(VibeflyProviderSettingsState::class.java)

        fun defaultAgentDir(): String {
            val home = System.getProperty("user.home") ?: ""
            return Path.of(home, ".omp", "agent").toString()
        }

        fun expandHome(path: String): String {
            val home = System.getProperty("user.home") ?: return path
            if (path == "~") return home
            if (path.startsWith("~/") || path.startsWith("~\\")) {
                return Path.of(home, path.substring(2)).toString()
            }
            return path
        }
    }
}
