package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

@Serializable
data class ProvidersRefreshResult(
    val ok: Boolean,
    val error: String? = null,
    val snapshot: ProvidersSnapshot? = null,
    val revision: String? = null,
    val conflict: Boolean = false,
)
