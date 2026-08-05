package com.github.sandogeek.vibefly.jcef.rpc

import com.intellij.ide.BrowserUtil
import com.intellij.openapi.diagnostic.logger

/**
 * Default shared [Ui2Host] for WebView panels.
 *
 * Chat panels supply model-preference / UI locale providers; settings panels override
 * [getIdeSettings] / [saveIdeSettings] for the full form.
 */
open class Ui2HostImpl(
    private val appVersion: String = DEFAULT_VERSION,
    private val modelPreferencesProvider: (() -> ModelPreferencesDto)? = null,
    private val modelPreferencesSaver: (suspend (ModelPreferencesDto) -> Unit)? = null,
    private val uiSettingsProvider: (() -> UiFormDto)? = null,
    private val openExternalUrlHandler: (suspend (String) -> Unit)? = null,
) : Ui2Host {

    override suspend fun getAppVersion(): String = appVersion

    override suspend fun logFromWeb(message: String) {
        log.info("WebView: $message")
    }

    override suspend fun getIdeSettings(): IdeSettingsDto = IdeSettingsDto(
        modelPreferences = modelPreferencesProvider?.invoke() ?: ModelPreferencesDto(),
        ui = uiSettingsProvider?.invoke() ?: UiFormDto(),
    )

    override suspend fun saveIdeSettings(settings: IdeSettingsDto) {
        modelPreferencesSaver?.invoke(settings.modelPreferences)
            ?: log.debug("saveIdeSettings ignored (no model preferences saver)")
    }

    override suspend fun openExternalUrl(url: String) {
        val target = url.trim()
        if (target.isEmpty()) return
        val handler = openExternalUrlHandler
        if (handler != null) {
            handler(target)
            return
        }
        try {
            BrowserUtil.browse(target)
        } catch (e: Exception) {
            log.warn("BrowserUtil.browse failed for $target", e)
        }
    }

    companion object {
        const val DEFAULT_VERSION: String = "0.0.1"
        private val log = logger<Ui2HostImpl>()
    }
}
