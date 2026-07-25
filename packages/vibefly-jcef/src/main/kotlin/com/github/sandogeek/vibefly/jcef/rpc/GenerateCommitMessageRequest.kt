package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

@Serializable
data class GenerateCommitMessageRequest(
    val files: List<CommitFileChange>,
    /**
     * Legacy style token (e.g. conventional_en). Prefer [language] when set.
     */
    val style: String = "conventional_en",
    /**
     * Recent commit messages from this repo (newest first), used as few-shot
     * style examples. Empty when history is unavailable.
     */
    val recentMessages: List<String> = emptyList(),
    /**
     * Commit-specific model as `provider/modelId`.
     * Empty/null means follow [defaultModel].
     */
    val commitModel: String? = null,
    /**
     * Providers default model as `provider/modelId`.
     * Used when [commitModel] is empty.
     */
    val defaultModel: String? = null,
    /**
     * Resolved language code from IDE settings (`en` or `zh`).
     * When set, overrides language parsed from [style].
     */
    val language: String? = null,
    /**
     * Custom system prompt. When non-empty, replaces the built-in
     * Conventional Commits prompt (language constraint is still appended).
     */
    val customPrompt: String? = null,
)
