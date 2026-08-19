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

    internal fun saveAuth(request: AuthSaveRequest): SettingsSaveResult =
        saveDocument(
            document = SettingsDocument.AUTH,
            json = request.authJson,
            expectedRevision = request.expectedRevision,
        )

    internal fun saveDocument(
        document: SettingsDocument,
        json: String,
        expectedRevision: String,
    ): SettingsSaveResult =
        store.saveDocument(document, json, expectedRevision).toRpcResult(document)

    override fun dispose() {
        store.close()
    }

    private fun publishChanged(snapshot: SettingsScopeSnapshot, changedDocuments: Set<SettingsDocument>) {
        if (changedDocuments.isEmpty()) return
        ApplicationManager.getApplication().messageBus
            .syncPublisher(VIBEFLY_SETTINGS_TOPIC)
            .settingsChanged(
                VibeflySettingsChanged(
                    scope = snapshot.scope,
                    projectRoot = null,
                    changes = changedDocuments.map { document ->
                        SettingsFileChange(
                            scope = snapshot.scope,
                            projectRoot = null,
                            document = document.fileName,
                            revision = snapshot.revision(document),
                        )
                    },
                ),
            )
    }

    companion object {
        private val log = logger<VibeflyApplicationSettingsService>()

        fun getInstance(): VibeflyApplicationSettingsService =
            ApplicationManager.getApplication().getService(VibeflyApplicationSettingsService::class.java)
    }
}

internal fun StoreSaveResult.toRpcResult(document: SettingsDocument? = null): SettingsSaveResult = SettingsSaveResult(
    ok = ok,
    revision = document?.let(snapshot::revision) ?: snapshot.revisions.values.firstOrNull().orEmpty(),
    conflict = conflict,
    error = error,
)
