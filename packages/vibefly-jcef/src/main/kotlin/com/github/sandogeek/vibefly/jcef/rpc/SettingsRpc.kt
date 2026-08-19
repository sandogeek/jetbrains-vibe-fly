package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

/** A syntax or persistence problem associated with one settings file. */
@Serializable
data class SettingsDiagnostic(
    val file: String,
    /** error | warning */
    val severity: String,
    val message: String,
)

/** Full snapshot available only on the trusted local Host <-> Agent stdio channel. */
@Serializable
data class AgentSettingsSnapshot(
    /** application | project */
    val scope: String,
    val projectRoot: String? = null,
    val settingsJson: String = "{}",
    val vibeflyJson: String = "{}",
    /** Present only for application scope. */
    val modelsJson: String? = null,
    /** Present only for application scope. */
    val authJson: String? = null,
    val revisions: Map<String, String> = emptyMap(),
    val diagnostics: List<SettingsDiagnostic> = emptyList(),
)

@Serializable
data class SettingsDocumentSaveRequest(
    /** application | project */
    val scope: String,
    val document: String,
    val json: String,
    val expectedRevision: String,
)

@Serializable
data class SettingsFileChange(
    /** application | project */
    val scope: String,
    val projectRoot: String? = null,
    val document: String,
    val revision: String,
)

@Serializable
data class SettingsChangedNotification(
    val changes: List<SettingsFileChange> = emptyList(),
)

@Serializable
data class AuthSaveRequest(
    val authJson: String,
    val expectedRevision: String,
)

@Serializable
data class SettingsSaveResult(
    val ok: Boolean,
    val revision: String,
    val conflict: Boolean = false,
    val error: String? = null,
)
