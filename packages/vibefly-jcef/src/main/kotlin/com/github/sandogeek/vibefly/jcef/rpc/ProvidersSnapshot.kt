package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

@Serializable
data class ProviderCredentialStatus(
    val hasApiKey: Boolean = false,
    val hasOAuth: Boolean = false,
    /** api_key | oauth | none */
    val originKind: String = "none",
)

/**
 * Mutable provider state only; immutable catalog metadata is generated directly for TypeScript.
 *
 * [configJson] is the full `models.json.providers[id]` entry (object JSON string), including
 * models, headers, apiKey, unknown fields, etc. Null when the provider exists only in auth.json.
 * auth.json secrets are never included — only [credential] status is projected.
 */
@Serializable
data class ProviderRuntimeSnapshot(
    val id: String,
    val configJson: String? = null,
    val credential: ProviderCredentialStatus = ProviderCredentialStatus(),
)

@Serializable
data class ProvidersSnapshot(
    val providers: List<ProviderRuntimeSnapshot> = emptyList(),
)
