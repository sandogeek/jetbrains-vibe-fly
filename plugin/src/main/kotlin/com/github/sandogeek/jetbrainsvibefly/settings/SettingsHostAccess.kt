package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.AgentSettingsSnapshot
import com.github.sandogeek.vibefly.jcef.rpc.SettingsSaveRequest
import com.github.sandogeek.vibefly.jcef.rpc.SettingsSaveResult
import com.github.sandogeek.vibefly.jcef.rpc.UiSettingsSnapshot
import com.intellij.openapi.project.Project

internal object SettingsHostAccess {
    fun uiSnapshot(scope: String, project: Project?): UiSettingsSnapshot =
        resolveSnapshot(scope, project).toUiSnapshot()

    fun agentSnapshot(scope: String, project: Project): AgentSettingsSnapshot =
        resolveSnapshot(scope, project).toAgentSnapshot()

    fun saveSettings(request: SettingsSaveRequest, project: Project?): SettingsSaveResult =
        when (normalizeScope(request.scope)) {
            SETTINGS_SCOPE_APPLICATION -> VibeflyApplicationSettingsService.getInstance().saveSettings(request)
            SETTINGS_SCOPE_PROJECT -> boundProjectService(project).saveSettings(request)
            else -> error("Unsupported settings scope: ${request.scope}")
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
 * Pass through raw settings/vibefly documents. Those two files must never store secrets
 * (credentials live only in auth.json / Providers path).
 */
private fun SettingsScopeSnapshot.toUiSnapshot(): UiSettingsSnapshot = UiSettingsSnapshot(
    scope = scope,
    projectRoot = projectRoot,
    settingsJson = content(SettingsDocument.SETTINGS),
    vibeflyJson = content(SettingsDocument.VIBEFLY),
    revision = revision,
    diagnostics = diagnostics,
)

private fun SettingsScopeSnapshot.toAgentSnapshot(): AgentSettingsSnapshot = AgentSettingsSnapshot(
    scope = scope,
    projectRoot = projectRoot,
    settingsJson = content(SettingsDocument.SETTINGS),
    vibeflyJson = content(SettingsDocument.VIBEFLY),
    modelsJson = if (scope == SETTINGS_SCOPE_APPLICATION) content(SettingsDocument.MODELS) else null,
    authJson = if (scope == SETTINGS_SCOPE_APPLICATION) content(SettingsDocument.AUTH) else null,
    revision = revision,
    diagnostics = diagnostics,
)
