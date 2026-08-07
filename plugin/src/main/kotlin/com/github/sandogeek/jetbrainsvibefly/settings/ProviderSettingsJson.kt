package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.*
import kotlinx.serialization.json.*
import java.net.URI

internal data class PatchedProviderDocuments(
    val modelsJson: String,
    val authJson: String,
    val modelsChanged: Boolean,
    val authChanged: Boolean,
)

/** Generic JSON projection/update helpers. Unknown keys are retained verbatim. */
internal object ProviderSettingsJson {
    private val prettyJson = Json { prettyPrint = true }

    fun snapshot(settings: SettingsScopeSnapshot): ProvidersSnapshot {
        val modelsRoot = parseObject(settings.content(SettingsDocument.MODELS), SettingsDocument.MODELS.fileName)
        val authRoot = parseObject(settings.content(SettingsDocument.AUTH), SettingsDocument.AUTH.fileName)
        val configured = modelsRoot["providers"] as? JsonObject ?: JsonObject(emptyMap())
        val providerIds = (configured.keys + authRoot.keys).toSortedSet()
        val providers = providerIds.map { providerId ->
            val entry = configured[providerId] as? JsonObject
            val credential = credentialStatus(authRoot[providerId])
            ProviderRuntimeSnapshot(
                id = providerId,
                isConfigured = entry != null,
                baseUrl = safeProviderUrl(entry?.string("baseUrl")),
                api = entry?.string("api"),
                models = entry?.models().orEmpty(),
                credential = credential,
            )
        }
        return ProvidersSnapshot(
            // Filesystem paths are deliberately not projected into the WebView.
            agentDir = "",
            providers = providers,
            modelsPath = null,
        )
    }

    fun applyPatch(
        settings: SettingsScopeSnapshot,
        request: ProvidersPatchRequest,
    ): PatchedProviderDocuments {
        val originalModelsRoot =
            parseObject(settings.content(SettingsDocument.MODELS), SettingsDocument.MODELS.fileName)
        val originalAuthRoot =
            parseObject(settings.content(SettingsDocument.AUTH), SettingsDocument.AUTH.fileName)
        val modelsRoot = originalModelsRoot
            .toMutableMap()
        val authRoot = originalAuthRoot
            .toMutableMap()
        val providers = ((modelsRoot["providers"] as? JsonObject)?.toMutableMap() ?: mutableMapOf())

        for (patch in request.providers) applyProviderPatch(providers, patch)
        for (action in request.credentials) applyCredentialAction(authRoot, action)

        // A credential-only (or completely empty) patch must leave models.json byte-for-byte
        // untouched. In particular, do not synthesize an empty `providers` object when the
        // source document omitted that key.
        if (request.providers.isNotEmpty()) {
            modelsRoot["providers"] = JsonObject(providers)
        }
        val patchedModelsRoot = JsonObject(modelsRoot)
        val patchedAuthRoot = JsonObject(authRoot)
        val modelsChanged = patchedModelsRoot != originalModelsRoot
        val authChanged = patchedAuthRoot != originalAuthRoot
        return PatchedProviderDocuments(
            modelsJson = if (modelsChanged) encode(patchedModelsRoot) else settings.content(SettingsDocument.MODELS),
            authJson = if (authChanged) encode(patchedAuthRoot) else settings.content(SettingsDocument.AUTH),
            modelsChanged = modelsChanged,
            authChanged = authChanged,
        )
    }

    private fun applyProviderPatch(
        providers: MutableMap<String, JsonElement>,
        patch: ProviderPatch,
    ) {
        val providerId = patch.id.trim()
        require(providerId.isNotEmpty()) { "Provider id is required" }
        if (patch.remove) {
            providers.remove(providerId)
            return
        }

        val entry = ((providers[providerId] as? JsonObject)?.toMutableMap() ?: mutableMapOf())
        when {
            patch.clearBaseUrl -> entry.remove("baseUrl")
            patch.baseUrl != null -> patch.baseUrl?.let { setTrimmed(entry, "baseUrl", it) }
        }
        when {
            patch.clearApi -> entry.remove("api")
            patch.api != null -> patch.api?.let { setTrimmed(entry, "api", it) }
        }

        // These fields belonged to an obsolete combined models/auth format.
        entry.remove("auth")
        entry.remove("apiKey")

        patch.models?.let { models ->
            val existingModels = (entry["models"] as? JsonArray)
                ?.mapNotNull { it as? JsonObject }
                ?.associateBy { it.string("id").orEmpty() }
                .orEmpty()
            val replacement = models.map { model ->
                providerModel(providerId, model, existingModels[model.id.trim()])
            }
            if (replacement.isNotEmpty()) {
                require(entry.string("baseUrl") != null) {
                    "Provider $providerId: baseUrl is required when defining custom models"
                }
                require(entry.string("api") != null || replacement.all { it.string("api") != null }) {
                    "Provider $providerId: api is required at provider or model level for custom models"
                }
            }
            entry["models"] = JsonArray(replacement)
        }

        if (entry.isEmpty()) providers.remove(providerId)
        else providers[providerId] = JsonObject(entry)
    }

    private fun providerModel(
        providerId: String,
        patch: ProviderModelPatch,
        existing: JsonObject?,
    ): JsonObject {
        val modelId = patch.id.trim()
        require(modelId.isNotEmpty()) { "Provider $providerId: model id is required" }
        val values = existing?.toMutableMap() ?: linkedMapOf()
        values["id"] = JsonPrimitive(modelId)
        values["name"] = JsonPrimitive(patch.name?.trim().orEmpty().ifEmpty { modelId })
        values.putIfAbsent("reasoning", JsonPrimitive(false))
        values.putIfAbsent("input", JsonArray(listOf(JsonPrimitive("text"))))
        values.putIfAbsent(
            "cost",
            JsonObject(
                linkedMapOf(
                    "input" to JsonPrimitive(0),
                    "output" to JsonPrimitive(0),
                    "cacheRead" to JsonPrimitive(0),
                    "cacheWrite" to JsonPrimitive(0),
                ),
            ),
        )
        values.putIfAbsent("contextWindow", JsonPrimitive(128000))
        values.putIfAbsent("maxTokens", JsonPrimitive(4096))
        val api = patch.api?.trim()?.takeIf(String::isNotEmpty)
        if (api == null) values.remove("api") else values["api"] = JsonPrimitive(api)
        return JsonObject(values)
    }

    private fun applyCredentialAction(
        auth: MutableMap<String, JsonElement>,
        action: CredentialAction,
    ) {
        val providerId = action.provider.trim()
        require(providerId.isNotEmpty()) { "Credential provider is required" }
        when (action.action.trim().lowercase()) {
            "set" -> {
                val key = action.apiKey?.trim().orEmpty()
                if (key.isNotEmpty()) {
                    val current = auth[providerId] as? JsonObject
                    val values = if (current?.string("type") == "api_key") {
                        current.toMutableMap()
                    } else {
                        linkedMapOf()
                    }
                    values["type"] = JsonPrimitive("api_key")
                    values["key"] = JsonPrimitive(key)
                    auth[providerId] = JsonObject(values)
                }
            }

            "clear" -> {
                val current = auth[providerId] as? JsonObject
                if (current?.string("type") == "api_key") auth.remove(providerId)
            }

            "logout" -> auth.remove(providerId)
            else -> error("Unknown credential action: ${action.action}")
        }
    }

    private fun credentialStatus(raw: JsonElement?): ProviderCredentialStatus {
        val type = (raw as? JsonObject)?.string("type")
        val hasApiKey = type == "api_key"
        val hasOAuth = type == "oauth"
        return ProviderCredentialStatus(
            hasApiKey = hasApiKey,
            hasOAuth = hasOAuth,
            originKind = when {
                hasOAuth -> "oauth"
                hasApiKey -> "api_key"
                else -> "none"
            },
        )
    }

    private fun safeProviderUrl(raw: String?): String? {
        val value = raw?.trim()?.takeIf(String::isNotEmpty) ?: return null
        return try {
            val parsed = URI(value)
            if (parsed.scheme == null || parsed.host == null) return null
            URI(
                parsed.scheme,
                null,
                parsed.host,
                parsed.port,
                parsed.path,
                null,
                null,
            ).toString()
        } catch (_: Exception) {
            null
        }
    }

    private fun JsonObject.models(): List<ProviderModelSnapshot> {
        val values = this["models"] as? JsonArray ?: return emptyList()
        return values.mapNotNull { raw ->
            val model = raw as? JsonObject ?: return@mapNotNull null
            val id = model.string("id") ?: return@mapNotNull null
            ProviderModelSnapshot(
                id = id,
                name = model.string("name") ?: id,
                api = model.string("api"),
                isCustom = true,
            )
        }
    }

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)
            ?.takeIf(JsonPrimitive::isString)
            ?.contentOrNull
            ?.trim()
            ?.takeIf(String::isNotEmpty)

    private fun MutableMap<String, JsonElement>.string(key: String): String? =
        (this[key] as? JsonPrimitive)
            ?.takeIf(JsonPrimitive::isString)
            ?.contentOrNull
            ?.trim()
            ?.takeIf(String::isNotEmpty)

    private fun setTrimmed(values: MutableMap<String, JsonElement>, key: String, raw: String) {
        val value = raw.trim()
        if (value.isEmpty()) values.remove(key) else values[key] = JsonPrimitive(value)
    }

    private fun parseObject(raw: String, fileName: String): JsonObject {
        val parsed = Json.parseToJsonElement(raw)
        require(parsed is JsonObject) { "$fileName must contain a JSON object" }
        return parsed
    }

    private fun encode(value: JsonObject): String =
        prettyJson.encodeToString(JsonElement.serializer(), value) + "\n"
}
