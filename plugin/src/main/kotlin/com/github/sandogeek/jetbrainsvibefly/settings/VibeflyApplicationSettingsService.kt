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
        val current = snapshot(refresh = true)
        val updates: Map<SettingsDocument, String> = try {
            buildMap {
                request.settingsJson?.let {
                    put(
                        SettingsDocument.SETTINGS,
                        UiSettingsJsonProjection.mergeSettings(
                            current.content(SettingsDocument.SETTINGS),
                            it,
                        ),
                    )
                }
                request.vibeflyJson?.let {
                    put(
                        SettingsDocument.VIBEFLY,
                        UiSettingsJsonProjection.mergeVibefly(
                            current.content(SettingsDocument.VIBEFLY),
                            it,
                        ),
                    )
                }
            }
        } catch (error: InvalidUiSettingsJsonException) {
            return SettingsSaveResult(
                ok = false,
                revision = current.revision,
                error = error.message,
            )
        }
        return store.saveDocuments(updates, request.expectedRevision).toRpcResult()
    }

    internal fun saveAuth(request: AuthSaveRequest): SettingsSaveResult =
        store.saveDocuments(
            updates = mapOf(SettingsDocument.AUTH to request.authJson),
            expectedRevision = request.expectedRevision,
        ).toRpcResult()

    internal fun applyProvidersPatch(
        request: ProvidersPatchRequest,
        expectedRevision: String,
    ): ProvidersPatchResult {
        val current = snapshot(refresh = true)
        if (current.revision != expectedRevision) {
            return ProvidersPatchResult(
                ok = false,
                error = "Settings revision conflict",
                snapshot = ProviderSettingsJson.snapshot(current),
                revision = current.revision,
                conflict = true,
            )
        }

        val patched = try {
            ProviderSettingsJson.applyPatch(current, request)
        } catch (error: Exception) {
            return ProvidersPatchResult(
                ok = false,
                error = error.message ?: "Invalid provider patch",
                snapshot = ProviderSettingsJson.snapshot(current),
                revision = current.revision,
            )
        }
        val result = store.saveDocuments(
            updates = buildMap {
                if (patched.modelsChanged) put(SettingsDocument.MODELS, patched.modelsJson)
                if (patched.authChanged) put(SettingsDocument.AUTH, patched.authJson)
            },
            expectedRevision = expectedRevision,
        )
        return ProvidersPatchResult(
            ok = result.ok,
            error = result.error,
            snapshot = ProviderSettingsJson.snapshot(result.snapshot),
            revision = result.snapshot.revision,
            conflict = result.conflict,
        )
    }

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
