package com.github.sandogeek.jetbrainsvibefly.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil
import java.util.Locale

/**
 * Application-level UI presentation settings (display language, etc.).
 */
@Service(Service.Level.APP)
@State(
    name = "VibeflyUiSettings",
    storages = [Storage("vibefly-ui.xml")],
)
class VibeflyUiSettingsState : PersistentStateComponent<VibeflyUiSettingsState> {

    /**
     * UI display language:
     * - [LOCALE_FOLLOW_IDE]
     * - [LOCALE_EN]
     * - [LOCALE_ZH]
     */
    var locale: String = LOCALE_FOLLOW_IDE

    override fun getState(): VibeflyUiSettingsState = this

    override fun loadState(state: VibeflyUiSettingsState) {
        XmlSerializerUtil.copyBean(state, this)
    }

    fun copyFrom(other: VibeflyUiSettingsState) {
        locale = other.locale
    }

    fun snapshot(): VibeflyUiSettingsState {
        val copy = VibeflyUiSettingsState()
        copy.copyFrom(this)
        return copy
    }

    companion object {
        const val LOCALE_FOLLOW_IDE: String = "follow_ide"
        const val LOCALE_EN: String = "en"
        const val LOCALE_ZH: String = "zh"

        fun getInstance(): VibeflyUiSettingsState =
            ApplicationManager.getApplication().getService(VibeflyUiSettingsState::class.java)

        fun normalizeLocale(raw: String): String {
            return when (raw.trim().lowercase(Locale.ROOT)) {
                LOCALE_EN, "english" -> LOCALE_EN
                LOCALE_ZH, "zh-cn", "zh_cn", "chinese", "cn" -> LOCALE_ZH
                else -> LOCALE_FOLLOW_IDE
            }
        }
    }
}
