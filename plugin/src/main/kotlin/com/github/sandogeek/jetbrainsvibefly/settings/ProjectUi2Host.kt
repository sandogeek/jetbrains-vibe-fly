package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.*
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import kotlinx.coroutines.*

/** Project-bound shared Host RPC used by a chat WebView. */
class ProjectUi2Host(
    private val project: Project,
    private val host2UiProvider: () -> Host2Ui?,
) : Ui2Host by Ui2HostImpl(), Disposable {
    private val notificationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val projectRoot = VibeflyProjectSettingsService.getInstance(project).projectRoot

    init {
        VibeflyApplicationSettingsService.getInstance()
        ApplicationManager.getApplication().messageBus
            .connect(this)
            .subscribe(
                VIBEFLY_SETTINGS_TOPIC,
                VibeflySettingsListener(::forwardSettingsChanged),
            )
    }

    override suspend fun getSettingsSnapshot(scope: String): UiSettingsSnapshot =
        SettingsHostAccess.uiSnapshot(scope, project)

    override suspend fun saveSettings(request: SettingsSaveRequest): SettingsSaveResult =
        SettingsHostAccess.saveSettings(request, project)

    override fun dispose() {
        notificationScope.cancel()
    }

    private fun forwardSettingsChanged(event: VibeflySettingsChanged) {
        val applies = event.scope == SETTINGS_SCOPE_APPLICATION ||
                (event.scope == SETTINGS_SCOPE_PROJECT && event.projectRoot == projectRoot)
        if (!applies) return
        val host2Ui = host2UiProvider() ?: return
        notificationScope.launch {
            try {
                host2Ui.settingsChanged(event.scope, event.projectRoot, event.revision)
            } catch (error: Exception) {
                log.debug("Host2Ui.settingsChanged failed", error)
            }
        }
    }

    companion object {
        private val log = logger<ProjectUi2Host>()
    }
}
