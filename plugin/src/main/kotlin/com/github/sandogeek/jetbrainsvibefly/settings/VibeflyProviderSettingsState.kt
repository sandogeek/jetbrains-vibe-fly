package com.github.sandogeek.jetbrainsvibefly.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil

/**
 * Application-level Vibe Fly provider settings.
 * API keys are never stored here; they live in the product-local agent directory.
 */
@Service(Service.Level.APP)
@State(
    name = "VibeflyProviderSettings",
    storages = [Storage("vibefly-providers.xml")],
)
class VibeflyProviderSettingsState : PersistentStateComponent<VibeflyProviderSettingsState> {

    /** Default provider id (e.g. openai). */
    var defaultProvider: String = ""

    /** Default model id within [defaultProvider]. */
    var defaultModel: String = ""

    override fun getState(): VibeflyProviderSettingsState = this

    override fun loadState(state: VibeflyProviderSettingsState) {
        XmlSerializerUtil.copyBean(state, this)
    }

    fun defaultModelSpec(): String {
        val p = defaultProvider.trim()
        val m = defaultModel.trim()
        if (p.isEmpty() || m.isEmpty()) return ""
        return "$p/$m"
    }

    fun copyFrom(other: VibeflyProviderSettingsState) {
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
    }
}
