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

/** WebView-safe raw settings projection. It deliberately has no modelsJson/authJson fields. */
@Serializable
data class UiSettingsSnapshot(
    /** application | project */
    val scope: String,
    val projectRoot: String? = null,
    val settingsJson: String = "{}",
    val vibeflyJson: String = "{}",
    val revision: String,
    val diagnostics: List<SettingsDiagnostic> = emptyList(),
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
    val revision: String,
    val diagnostics: List<SettingsDiagnostic> = emptyList(),
)

@Serializable
data class SettingsSaveRequest(
    /** application | project */
    val scope: String,
    val settingsJson: String? = null,
    val vibeflyJson: String? = null,
    val expectedRevision: String,
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
