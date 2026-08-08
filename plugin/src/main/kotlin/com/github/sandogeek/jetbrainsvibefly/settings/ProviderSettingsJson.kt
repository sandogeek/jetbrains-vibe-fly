package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.*
import kotlinx.serialization.json.*

internal data class PatchedProviderDocuments(
    val modelsJson: String,
    val authJson: String,
    val modelsChanged: Boolean,
    val authChanged: Boolean,
)

/**
 * Full Provider entry JSON helpers.
 * [ProviderRuntimeSnapshot.configJson] is the complete `models.json.providers[id]` object;
 * [applyPatch] replaces that entry wholesale. Unknown keys are retained verbatim.
 * auth.json is never projected into the WebView — only [ProviderCredentialStatus].
 */
internal object ProviderSettingsJson {
    private val prettyJson = Json { prettyPrint = true }
    private val compactJson = Json

    private const val DEFAULT_CONTEXT_WINDOW = 128000
    private const val DEFAULT_MAX_TOKENS = 16384

    fun snapshot(settings: SettingsScopeSnapshot): ProvidersSnapshot {
        val modelsRoot = parseObject(settings.content(SettingsDocument.MODELS), SettingsDocument.MODELS.fileName)
        val authRoot = parseObject(settings.content(SettingsDocument.AUTH), SettingsDocument.AUTH.fileName)
        val configured = modelsRoot["providers"] as? JsonObject ?: JsonObject(emptyMap())
        val providerIds = (configured.keys + authRoot.keys).toSortedSet()
        val providers = providerIds.map { providerId ->
            val entry = configured[providerId] as? JsonObject
            ProviderRuntimeSnapshot(
                id = providerId,
                configJson = entry?.let { compactJson.encodeToString(JsonElement.serializer(), it) },
                credential = credentialStatus(authRoot[providerId]),
            )
        }
        return ProvidersSnapshot(providers = providers)
    }

    fun applyPatch(
        settings: SettingsScopeSnapshot,
        request: ProvidersPatchRequest,
    ): PatchedProviderDocuments {
        val originalModelsRoot =
            parseObject(settings.content(SettingsDocument.MODELS), SettingsDocument.MODELS.fileName)
        val originalAuthRoot =
            parseObject(settings.content(SettingsDocument.AUTH), SettingsDocument.AUTH.fileName)
        val modelsRoot = originalModelsRoot.toMutableMap()
        val authRoot = originalAuthRoot.toMutableMap()
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

        val rawConfig = patch.configJson?.trim().orEmpty()
        require(rawConfig.isNotEmpty()) { "Provider $providerId: configJson is required" }
        val parsed = Json.parseToJsonElement(rawConfig)
        require(parsed is JsonObject) { "Provider $providerId: configJson must be a JSON object" }
        require(parsed["providers"] == null) {
            "Provider $providerId: configJson must be a single provider entry, not a providers map"
        }

        val validated = validateProviderEntry(providerId, parsed)
        providers[providerId] = validated
    }

    private fun validateProviderEntry(providerId: String, entry: JsonObject): JsonObject {
        val values = entry.toMutableMap()
        val modelsElement = values["models"]
        if (modelsElement != null) {
            require(modelsElement is JsonArray) { "Provider $providerId: models must be an array" }
            val seenIds = linkedSetOf<String>()
            val validatedModels = modelsElement.mapIndexed { index, raw ->
                require(raw is JsonObject) { "Provider $providerId: models[$index] must be an object" }
                validateModel(providerId, index, raw, seenIds)
            }
            values["models"] = JsonArray(validatedModels)
        }

        validateOptionalString(values, "baseUrl", providerId)
        validateOptionalString(values, "api", providerId)
        validateOptionalString(values, "name", providerId)
        validateOptionalString(values, "apiKey", providerId)
        validateOptionalBoolean(values, "authHeader", providerId)
        validateOptionalObject(values, "headers", providerId)
        validateOptionalObject(values, "compat", providerId)
        validateOptionalObject(values, "modelOverrides", providerId)

        val models = values["models"] as? JsonArray
        if (models != null && models.isNotEmpty()) {
            val providerBaseUrl = values.string("baseUrl")
            val providerApi = values.string("api")
            val allModelsHaveBaseUrl = models.all { (it as? JsonObject)?.string("baseUrl") != null }
            val allModelsHaveApi = models.all { (it as? JsonObject)?.string("api") != null }
            require(providerBaseUrl != null || allModelsHaveBaseUrl) {
                "Provider $providerId: baseUrl is required when defining custom models"
            }
            require(providerApi != null || allModelsHaveApi) {
                "Provider $providerId: api is required at provider or model level for custom models"
            }
        }

        return JsonObject(values)
    }

    private fun validateModel(
        providerId: String,
        index: Int,
        model: JsonObject,
        seenIds: MutableSet<String>,
    ): JsonObject {
        val values = model.toMutableMap()
        val modelId = values.string("id")
        require(modelId != null) { "Provider $providerId: models[$index].id is required" }
        require(seenIds.add(modelId)) { "Provider $providerId: duplicate model id \"$modelId\"" }

        if (values["name"] == null) {
            values["name"] = JsonPrimitive(modelId)
        } else {
            validateOptionalString(values, "name", "$providerId models[$index]")
        }
        validateOptionalString(values, "api", "$providerId models[$index]")
        validateOptionalString(values, "baseUrl", "$providerId models[$index]")
        validateOptionalBoolean(values, "reasoning", "$providerId models[$index]")
        validateOptionalObject(values, "headers", "$providerId models[$index]")
        validateOptionalObject(values, "compat", "$providerId models[$index]")
        validateOptionalObject(values, "thinkingLevelMap", "$providerId models[$index]")

        when (val input = values["input"]) {
            null -> values["input"] = JsonArray(listOf(JsonPrimitive("text")))
            is JsonArray -> {
                require(input.all { it is JsonPrimitive && it.isString }) {
                    "Provider $providerId: models[$index].input must be an array of strings"
                }
            }

            else -> error("Provider $providerId: models[$index].input must be an array of strings")
        }

        when (val cost = values["cost"]) {
            null -> values["cost"] = defaultCost()
            is JsonObject -> validateCost(providerId, index, cost)
            else -> error("Provider $providerId: models[$index].cost must be an object")
        }

        when (val ctx = values["contextWindow"]) {
            null -> values["contextWindow"] = JsonPrimitive(DEFAULT_CONTEXT_WINDOW)
            is JsonPrimitive -> require(ctx.longOrNull != null || ctx.doubleOrNull != null) {
                "Provider $providerId: models[$index].contextWindow must be a number"
            }

            else -> error("Provider $providerId: models[$index].contextWindow must be a number")
        }

        when (val max = values["maxTokens"]) {
            null -> values["maxTokens"] = JsonPrimitive(DEFAULT_MAX_TOKENS)
            is JsonPrimitive -> require(max.longOrNull != null || max.doubleOrNull != null) {
                "Provider $providerId: models[$index].maxTokens must be a number"
            }

            else -> error("Provider $providerId: models[$index].maxTokens must be a number")
        }

        return JsonObject(values)
    }

    private fun validateCost(providerId: String, index: Int, cost: JsonObject) {
        for (key in listOf("input", "output", "cacheRead", "cacheWrite")) {
            val value = cost[key] ?: continue
            require(value is JsonPrimitive && (value.longOrNull != null || value.doubleOrNull != null)) {
                "Provider $providerId: models[$index].cost.$key must be a number"
            }
        }
        when (val tiers = cost["tiers"]) {
            null -> Unit
            is JsonArray -> Unit
            else -> error("Provider $providerId: models[$index].cost.tiers must be an array")
        }
    }

    private fun defaultCost(): JsonObject = JsonObject(
        linkedMapOf(
            "input" to JsonPrimitive(0),
            "output" to JsonPrimitive(0),
            "cacheRead" to JsonPrimitive(0),
            "cacheWrite" to JsonPrimitive(0),
        ),
    )

    private fun validateOptionalString(values: MutableMap<String, JsonElement>, key: String, context: String) {
        when (val value = values[key]) {
            null -> Unit
            is JsonPrimitive -> require(value.isString) { "$context: $key must be a string" }
            else -> error("$context: $key must be a string")
        }
    }

    private fun validateOptionalBoolean(values: MutableMap<String, JsonElement>, key: String, context: String) {
        when (val value = values[key]) {
            null -> Unit
            is JsonPrimitive -> require(value.booleanOrNull != null) { "$context: $key must be a boolean" }
            else -> error("$context: $key must be a boolean")
        }
    }

    private fun validateOptionalObject(values: MutableMap<String, JsonElement>, key: String, context: String) {
        when (val value = values[key]) {
            null -> Unit
            is JsonObject -> Unit
            else -> error("$context: $key must be an object")
        }
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

    private fun parseObject(raw: String, fileName: String): JsonObject {
        val parsed = Json.parseToJsonElement(raw)
        require(parsed is JsonObject) { "$fileName must contain a JSON object" }
        return parsed
    }

    private fun encode(value: JsonObject): String =
        prettyJson.encodeToString(JsonElement.serializer(), value) + "\n"
}
