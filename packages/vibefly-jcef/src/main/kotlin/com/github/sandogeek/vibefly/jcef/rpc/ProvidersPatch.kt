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
data class CredentialAction(
    val provider: String,
    /** set | clear | logout */
    val action: String,
    /** Required when action is set; empty/null is ignored for set. */
    val apiKey: String? = null,
)

@Serializable
data class ProvidersPatchRequest(
    val providers: List<ProviderPatch> = emptyList(),
    val credentials: List<CredentialAction> = emptyList(),
)

@Serializable
data class ProvidersPatchResult(
    val ok: Boolean,
    val error: String? = null,
    val snapshot: ProvidersSnapshot? = null,
    val revision: String? = null,
    val conflict: Boolean = false,
)
