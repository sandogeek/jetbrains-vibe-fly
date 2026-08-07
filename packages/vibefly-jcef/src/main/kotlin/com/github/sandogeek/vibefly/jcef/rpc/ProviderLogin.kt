package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

@Serializable
data class LoginProviderInfo(
    val id: String,
    val name: String = "",
    val available: Boolean = true,
    /** Credential storage id when different from [id] (e.g. openai-codex-device → openai-codex). */
    val storeCredentialsAs: String? = null,
    val authenticated: Boolean = false,
)

@Serializable
data class LoginProvidersList(
    val providers: List<LoginProviderInfo> = emptyList(),
)

@Serializable
data class ProviderLoginRequest(
    val providerId: String,
)

@Serializable
data class ProviderLoginResult(
    val ok: Boolean,
    val error: String? = null,
    /** oauth | api_key | none */
    val identityType: String? = null,
    val email: String? = null,
    val accountId: String? = null,
    val orgId: String? = null,
    val orgName: String? = null,
    val snapshot: ProvidersSnapshot? = null,
    val revision: String? = null,
    val conflict: Boolean = false,
)

@Serializable
data class ProviderLogoutRequest(
    val providerId: String,
)

@Serializable
data class ProviderLogoutResult(
    val ok: Boolean,
    val error: String? = null,
    val snapshot: ProvidersSnapshot? = null,
    val revision: String? = null,
    val conflict: Boolean = false,
)

@Serializable
data class LoginOpenUrlRequest(
    val url: String,
    val launchUrl: String? = null,
    val instructions: String? = null,
)

@Serializable
data class LoginInputRequest(
    val message: String,
    val placeholder: String? = null,
    val allowEmpty: Boolean = false,
)

@Serializable
data class LoginInputResponse(
    val text: String = "",
    val cancelled: Boolean = false,
)
