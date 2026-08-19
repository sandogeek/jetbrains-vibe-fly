package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.AgentSettingsSnapshot
import com.github.sandogeek.vibefly.jcef.rpc.SettingsSaveResult
import com.github.sandogeek.vibefly.jcef.rpc.SettingsDocumentSaveRequest
import com.intellij.openapi.project.Project

internal object SettingsHostAccess {
    fun agentSnapshot(scope: String, project: Project): AgentSettingsSnapshot =
        resolveSnapshot(scope, project).toAgentSnapshot()

    fun saveSettingsDocument(request: SettingsDocumentSaveRequest, project: Project?): SettingsSaveResult {
        val document = settingsDocumentOf(request.document)
            ?: return SettingsSaveResult(
                ok = false,
                revision = "",
                error = "${request.document} is not a settings document",
            )
        return when (normalizeScope(request.scope)) {
            SETTINGS_SCOPE_APPLICATION -> VibeflyApplicationSettingsService.getInstance()
                .saveDocument(document, request.json, request.expectedRevision)
            SETTINGS_SCOPE_PROJECT -> {
                require(document == SettingsDocument.SETTINGS || document == SettingsDocument.VIBEFLY) {
                    "${document.fileName} is only supported for application scope"
                }
                boundProjectService(project).saveDocument(document, request.json, request.expectedRevision)
            }
            else -> error("Unsupported settings scope: ${request.scope}")
        }
    }

    private fun resolveSnapshot(scope: String, project: Project?): SettingsScopeSnapshot =
        when (normalizeScope(scope)) {
            SETTINGS_SCOPE_APPLICATION -> VibeflyApplicationSettingsService.getInstance().snapshot()
            SETTINGS_SCOPE_PROJECT -> boundProjectService(project).snapshot()
            else -> error("Unsupported settings scope: $scope")
        }

    private fun boundProjectService(project: Project?): VibeflyProjectSettingsService {
        val bound = project?.takeUnless(Project::isDisposed)
            ?: error("Project settings require a project-bound RPC session")
        return VibeflyProjectSettingsService.getInstance(bound).also {
            require(it.projectRoot != null) { "Project has no valid base path" }
        }
    }

    private fun normalizeScope(scope: String): String = scope.trim().lowercase()
}

/**
 * Trusted Host ↔ Agent projection. settings/vibefly must never store secrets;
 * credentials live only in auth.json.
 */
private fun SettingsScopeSnapshot.toAgentSnapshot(): AgentSettingsSnapshot = AgentSettingsSnapshot(
    scope = scope,
    projectRoot = projectRoot,
    settingsJson = content(SettingsDocument.SETTINGS),
    vibeflyJson = content(SettingsDocument.VIBEFLY),
    modelsJson = if (scope == SETTINGS_SCOPE_APPLICATION) content(SettingsDocument.MODELS) else null,
    authJson = if (scope == SETTINGS_SCOPE_APPLICATION) content(SettingsDocument.AUTH) else null,
    revisions = revisions.mapKeys { it.key.fileName },
    diagnostics = diagnostics,
)
