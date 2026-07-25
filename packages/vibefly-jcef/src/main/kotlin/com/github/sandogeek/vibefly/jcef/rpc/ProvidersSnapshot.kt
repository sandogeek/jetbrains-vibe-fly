package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

@Serializable
data class ProviderCredentialStatus(
    val hasApiKey: Boolean = false,
    val hasOAuth: Boolean = false,
    /** api_key | oauth | env | runtime | config | fallback | none */
    val originKind: String = "none",
)

@Serializable
data class ProviderModelSnapshot(
    val id: String,
    val name: String? = null,
    val api: String? = null,
    val isCustom: Boolean = false,
)

@Serializable
data class ProviderSnapshot(
    val id: String,
    val isCatalog: Boolean = false,
    val isConfigured: Boolean = false,
    val baseUrl: String? = null,
    val api: String? = null,
    /** apiKey | none | oauth */
    val auth: String? = null,
    val models: List<ProviderModelSnapshot> = emptyList(),
    val credential: ProviderCredentialStatus = ProviderCredentialStatus(),
    /** True when Oh My Pi exposes a `/login` flow for this provider id. */
    val supportsLogin: Boolean = false,
    /** Login registry id when different from [id] (rarely set). */
    val loginProviderId: String? = null,
)

@Serializable
data class ProvidersSnapshot(
    val agentDir: String,
    val providers: List<ProviderSnapshot> = emptyList(),
    val modelsPath: String? = null,
)
