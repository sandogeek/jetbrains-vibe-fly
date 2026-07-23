package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

@Serializable
data class GenerateCommitMessageResult(
    val message: String,
)
