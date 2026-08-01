package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

@Serializable
data class ProviderModelPatch(
    val id: String,
    val name: String? = null,
    val api: String? = null,
)

@Serializable
data class ProviderPatch(
    val id: String,
    /** Remove this provider entry from models.yml (custom providers). */
    val remove: Boolean = false,
    val baseUrl: String? = null,
    val api: String? = null,
    /** apiKey | none | oauth */
    val auth: String? = null,
    /**
     * When non-null, replace the models list for this provider.
     * null means leave models untouched.
     */
    val models: List<ProviderModelPatch>? = null,
    val clearBaseUrl: Boolean = false,
    val clearApi: Boolean = false,
)

@Serializable
data class CredentialAction(
    val provider: String,
    /** set | clear */
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
)
