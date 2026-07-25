package com.github.sandogeek.jetbrainsvibefly.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil
import java.util.Locale

/**
 * Application-level Commit Message settings.
 * Commit generation config is IDE settings + RPC only (no env var path).
 */
@Service(Service.Level.APP)
@State(
    name = "VibeflyCommitMessageSettings",
    storages = [Storage("vibefly-commit-message.xml")],
)
class VibeflyCommitMessageSettingsState : PersistentStateComponent<VibeflyCommitMessageSettingsState> {

    /**
     * Language selection:
     * - [LANGUAGE_FOLLOW_IDE]
     * - [LANGUAGE_EN]
     * - [LANGUAGE_ZH]
     */
    var languageMode: String = LANGUAGE_FOLLOW_IDE

    /**
     * Commit-specific model as `provider/modelId`.
     * Empty = follow Providers default model.
     */
    var commitModelSpec: String = ""

    var useCustomPrompt: Boolean = false

    var customPrompt: String = ""

    override fun getState(): VibeflyCommitMessageSettingsState = this

    override fun loadState(state: VibeflyCommitMessageSettingsState) {
        XmlSerializerUtil.copyBean(state, this)
    }

    fun copyFrom(other: VibeflyCommitMessageSettingsState) {
        languageMode = other.languageMode
        commitModelSpec = other.commitModelSpec
        useCustomPrompt = other.useCustomPrompt
        customPrompt = other.customPrompt
    }

    fun snapshot(): VibeflyCommitMessageSettingsState {
        val copy = VibeflyCommitMessageSettingsState()
        copy.copyFrom(this)
        return copy
    }

    /** Effective language code for RPC: `en` or `zh`. */
    fun resolvedLanguage(ideLocale: Locale = Locale.getDefault()): String =
        resolveLanguage(languageMode, ideLocale)

    /**
     * Effective commit model for RPC.
     * Empty when following default model (caller should send [defaultModel] separately).
     */
    fun resolvedCommitModelSpec(connectedOptions: Collection<String> = emptyList()): String {
        val raw = commitModelSpec.trim()
        if (raw.isEmpty()) return ""
        if (connectedOptions.isNotEmpty() && raw !in connectedOptions) return ""
        return raw
    }

    /** Custom prompt text for RPC, or empty when disabled / blank. */
    fun resolvedCustomPrompt(): String {
        if (!useCustomPrompt) return ""
        return customPrompt.trim()
    }

    companion object {
        const val LANGUAGE_FOLLOW_IDE: String = "follow_ide"
        const val LANGUAGE_EN: String = "en"
        const val LANGUAGE_ZH: String = "zh"

        fun getInstance(): VibeflyCommitMessageSettingsState =
            ApplicationManager.getApplication().getService(VibeflyCommitMessageSettingsState::class.java)

        fun resolveLanguage(mode: String, ideLocale: Locale = Locale.getDefault()): String {
            return when (mode.trim().lowercase(Locale.ROOT)) {
                LANGUAGE_EN, "english" -> "en"
                LANGUAGE_ZH, "zh-cn", "zh_cn", "chinese", "cn" -> "zh"
                else -> languageFromIdeLocale(ideLocale)
            }
        }

        fun languageFromIdeLocale(locale: Locale): String {
            val lang = locale.language.lowercase(Locale.ROOT)
            return if (lang == "zh") "zh" else "en"
        }

        fun normalizeLanguageMode(raw: String): String {
            return when (raw.trim().lowercase(Locale.ROOT)) {
                LANGUAGE_EN, "english" -> LANGUAGE_EN
                LANGUAGE_ZH, "zh-cn", "zh_cn", "chinese", "cn" -> LANGUAGE_ZH
                else -> LANGUAGE_FOLLOW_IDE
            }
        }
    }
}
