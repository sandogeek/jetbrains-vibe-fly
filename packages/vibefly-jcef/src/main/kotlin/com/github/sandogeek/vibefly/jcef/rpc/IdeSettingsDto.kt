package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

@Serializable
data class ProvidersFormDto(
    val defaultProvider: String = "",
    val defaultModel: String = "",
)

@Serializable
data class CommitFormDto(
    /** follow_ide | en | zh — matches VibeflyCommitMessageSettingsState literals. */
    val languageMode: String = "follow_ide",
    val commitModelSpec: String = "",
    val useCustomPrompt: Boolean = false,
    val customPrompt: String = "",
)

@Serializable
data class ModelPreferencesDto(
    val recentModelSpecs: List<String> = emptyList(),
    val pinnedModelSpecs: List<String> = emptyList(),
)

@Serializable
data class IdeSettingsDto(
    val providers: ProvidersFormDto = ProvidersFormDto(),
    val commit: CommitFormDto = CommitFormDto(),
    val modelPreferences: ModelPreferencesDto = ModelPreferencesDto(),
)

@Serializable
data class ProvidersRefreshResult(
    val ok: Boolean,
    val error: String? = null,
    val snapshot: ProvidersSnapshot? = null,
)
