package com.github.sandogeek.jetbrainsvibefly.settings

import java.nio.file.Path

internal data class ResolvedSettingsFile(
    val scope: String,
    val document: SettingsDocument,
    val path: Path,
)

internal data class SettingsFileResolveResult(
    val ok: Boolean,
    val file: ResolvedSettingsFile? = null,
    val error: String? = null,
)

/**
 * Resolves the Host-owned path for a settings JSON file.
 *
 * The WebView may only pass [scope] and a document file name; this helper never
 * accepts an arbitrary path from UI or Agent.
 */
internal object SettingsFileOpener {
    private val applicationDocuments = setOf(
        SettingsDocument.SETTINGS,
        SettingsDocument.VIBEFLY,
        SettingsDocument.MODELS,
    )
    private val projectDocuments = setOf(
        SettingsDocument.SETTINGS,
        SettingsDocument.VIBEFLY,
    )

    fun resolve(
        scope: String,
        document: String,
        applicationDirectory: Path,
        projectRoot: String?,
    ): SettingsFileResolveResult {
        val normalizedScope = scope.trim().lowercase()
        if (normalizedScope != SETTINGS_SCOPE_APPLICATION && normalizedScope != SETTINGS_SCOPE_PROJECT) {
            return fail("Unsupported settings scope: $scope")
        }
        val fileName = document.trim()
        if (fileName.isEmpty()) {
            return fail("document is required")
        }
        val settingsDocument = settingsDocumentOf(fileName)
            ?: return fail("$fileName is not a settings document")
        if (settingsDocument == SettingsDocument.AUTH) {
            return fail("auth.json cannot be opened from the settings UI")
        }
        val allowedDocuments = if (normalizedScope == SETTINGS_SCOPE_APPLICATION) {
            applicationDocuments
        } else {
            projectDocuments
        }
        if (settingsDocument !in allowedDocuments) {
            return fail("${settingsDocument.fileName} is only supported for application scope")
        }
        val directory = when (normalizedScope) {
            SETTINGS_SCOPE_APPLICATION -> applicationDirectory.toAbsolutePath().normalize()
            SETTINGS_SCOPE_PROJECT -> {
                val root = projectRoot?.trim()?.takeIf(String::isNotEmpty)
                    ?: return fail("Project has no valid base path")
                Path.of(root).toAbsolutePath().normalize().resolve(PROJECT_SETTINGS_DIRECTORY_NAME)
            }
            else -> return fail("Unsupported settings scope: $scope")
        }
        return SettingsFileResolveResult(
            ok = true,
            file = ResolvedSettingsFile(
                scope = normalizedScope,
                document = settingsDocument,
                path = directory.resolve(settingsDocument.fileName),
            ),
        )
    }

    private fun fail(error: String): SettingsFileResolveResult =
        SettingsFileResolveResult(ok = false, error = error)
}
