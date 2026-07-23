package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

@Serializable
data class GenerateCommitMessageRequest(
    val files: List<CommitFileChange>,
    val style: String = "conventional_en",
    /**
     * Recent commit messages from this repo (newest first), used as few-shot
     * style examples. Empty when history is unavailable.
     */
    val recentMessages: List<String> = emptyList(),
)
