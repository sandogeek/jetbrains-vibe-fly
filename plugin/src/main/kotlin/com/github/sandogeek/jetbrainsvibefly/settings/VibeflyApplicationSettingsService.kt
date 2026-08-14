package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.agent.VibeflyAgentDirectory
import com.github.sandogeek.vibefly.jcef.rpc.*
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import java.nio.file.Path

@Service(Service.Level.APP)
class VibeflyApplicationSettingsService : Disposable {
    private val store = SettingsScopeStore(
        scope = SETTINGS_SCOPE_APPLICATION,
        projectRoot = null,
        directory = Path.of(VibeflyAgentDirectory.current()),
        allowedDocuments = setOf(
            SettingsDocument.SETTINGS,
            SettingsDocument.VIBEFLY,
            SettingsDocument.MODELS,
            SettingsDocument.AUTH,
        ),
        ownerOnlyDirectory = true,
        onChanged = ::publishChanged,
        onWarning = { message, error ->
            if (error == null) log.warn(message) else log.warn(message, error)
        },
    )

    internal fun snapshot(refresh: Boolean = false): SettingsScopeSnapshot =
        if (refresh) store.reloadFromDisk() else store.snapshot()

    internal fun saveSettings(request: SettingsSaveRequest): SettingsSaveResult {
        require(request.scope == SETTINGS_SCOPE_APPLICATION) {
            "Application settings service cannot save ${request.scope} scope"
        }
        val updates = buildMap {
            request.settingsJson?.let { put(SettingsDocument.SETTINGS, it) }
            request.vibeflyJson?.let { put(SettingsDocument.VIBEFLY, it) }
        }
        return store.saveDocuments(updates, request.expectedRevision).toRpcResult()
    }

    internal fun saveAuth(request: AuthSaveRequest): SettingsSaveResult =
        saveProviderDocuments(
            modelsJson = null,
            authJson = request.authJson,
            expectedRevision = request.expectedRevision,
        )

    internal fun saveProviderDocuments(
        modelsJson: String?,
        authJson: String?,
        expectedRevision: String,
    ): SettingsSaveResult =
        store.saveDocuments(
            updates = buildMap {
                modelsJson?.let { put(SettingsDocument.MODELS, it) }
                authJson?.let { put(SettingsDocument.AUTH, it) }
            },
            expectedRevision = expectedRevision,
        ).toRpcResult()

    override fun dispose() {
        store.close()
    }

    private fun publishChanged(snapshot: SettingsScopeSnapshot) {
        ApplicationManager.getApplication().messageBus
            .syncPublisher(VIBEFLY_SETTINGS_TOPIC)
            .settingsChanged(
                VibeflySettingsChanged(
                    scope = snapshot.scope,
                    projectRoot = null,
                    revision = snapshot.revision,
                ),
            )
    }

    companion object {
        private val log = logger<VibeflyApplicationSettingsService>()

        fun getInstance(): VibeflyApplicationSettingsService =
            ApplicationManager.getApplication().getService(VibeflyApplicationSettingsService::class.java)
    }
}

internal fun StoreSaveResult.toRpcResult(): SettingsSaveResult = SettingsSaveResult(
    ok = ok,
    revision = snapshot.revision,
    conflict = conflict,
    error = error,
)
