package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

/**
 * Full-replacement provider patch.
 *
 * - [remove]=true deletes the entire provider entry from models.json.
 * - Non-remove operations must provide [configJson]: a JSON object representing a single
 *   `models.json.providers[id]` entry (not wrapped in an outer `providers` map). The entry
 *   replaces the previous one wholesale; unknown fields are retained as supplied.
 */
@Serializable
data class ProviderPatch(
    val id: String,
    /** Remove this provider entry from models.json (custom providers). */
    val remove: Boolean = false,
    /** Full provider entry JSON object. Required when [remove] is false. */
    val configJson: String? = null,
)

@Serializable
data class ProvidersPatchRequest(
    val providers: List<ProviderPatch> = emptyList(),
)

@Serializable
data class ProvidersPatchResult(
    val ok: Boolean,
    val error: String? = null,
    val snapshot: ProvidersSnapshot? = null,
    val revision: String? = null,
    val conflict: Boolean = false,
)

/**
 * Trusted stdio result of a models.json-only Agent transform.
 * Host stamps revision after an atomic models.json save and never writes auth.json.
 */
@Serializable
data class ModelsDocumentPatchResult(
    val ok: Boolean,
    val error: String? = null,
    val modelsJson: String? = null,
    val modelsChanged: Boolean = false,
)

@Serializable
data class ProviderApiKeyRequest(
    val providerId: String,
    val apiKey: String,
)

@Serializable
data class ProviderApiKeyResult(
    val ok: Boolean,
    val error: String? = null,
)

/**
 * Atomic custom-provider mutation across models.json and optional auth.json.
 *
 * - [remove]=true deletes the models.json entry and any credential for [id].
 * - Non-remove operations replace the models.json entry with [configJson].
 * - Non-blank [apiKey] writes an api_key credential; blank/null leaves auth.json unchanged.
 */
@Serializable
data class CustomProviderMutationRequest(
    val id: String,
    val remove: Boolean = false,
    val configJson: String? = null,
    val apiKey: String? = null,
)

/**
 * Trusted stdio result of a pure Agent-side custom-provider transform.
 * Host stamps revision after an atomic models.json / auth.json save.
 */
@Serializable
data class ProviderDocumentsPatchResult(
    val ok: Boolean,
    val error: String? = null,
    val modelsJson: String? = null,
    val authJson: String? = null,
    val modelsChanged: Boolean = false,
    val authChanged: Boolean = false,
    val snapshot: ProvidersSnapshot? = null,
)
