package com.github.sandogeek.vibefly.jcef.rpc

import com.intellij.ide.BrowserUtil
import com.intellij.openapi.diagnostic.logger

/**
 * Default shared [Ui2Host] for WebView panels.
 *
 * Project-bound panels override the settings snapshot and save methods.
 */
open class Ui2HostImpl(
    private val appVersion: String = DEFAULT_VERSION,
    private val settingsSnapshotProvider: (suspend (String) -> UiSettingsSnapshot)? = null,
    private val settingsSaver: (suspend (SettingsSaveRequest) -> SettingsSaveResult)? = null,
    private val openExternalUrlHandler: (suspend (String) -> Unit)? = null,
) : Ui2Host {

    override suspend fun getAppVersion(): String = appVersion

    override suspend fun logFromWeb(message: String) {
        log.info("WebView: $message")
    }

    override suspend fun getSettingsSnapshot(scope: String): UiSettingsSnapshot =
        settingsSnapshotProvider?.invoke(scope)
            ?: error("Settings host is not bound to a project or application store")

    override suspend fun saveSettings(request: SettingsSaveRequest): SettingsSaveResult =
        settingsSaver?.invoke(request)
            ?: SettingsSaveResult(
                ok = false,
                revision = EMPTY_SETTINGS_REVISION,
                error = "Settings host is not bound to a project or application store",
            )

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
            log.warn("BrowserUtil.browse failed", e)
        }
    }

    companion object {
        const val DEFAULT_VERSION: String = "0.0.1"
        private const val EMPTY_SETTINGS_REVISION: String = "unbound"
        private val log = logger<Ui2HostImpl>()
    }
}
