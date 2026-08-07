package com.github.sandogeek.jetbrainsvibefly.settings

import kotlinx.serialization.json.*

/**
 * The WebView only edits this small, non-secret settings surface. Keeping the allowlist here
 * means a future pi setting (for example a proxy URL with embedded credentials) cannot be
 * reflected into the browser accidentally. Host merges the returned projection back into the
 * original document so unknown keys remain forward-compatible and never cross the JCEF boundary.
 */
internal object UiSettingsJsonProjection {
    private val json = Json { prettyPrint = true }

    private val settingsFields = mapOf(
        "defaultProvider" to SafeValueKind.STRING,
        "defaultModel" to SafeValueKind.STRING,
    )
    private val vibeflyKeys = mapOf(
        "commit" to mapOf(
            "languageMode" to SafeValueKind.STRING,
            "commitModelSpec" to SafeValueKind.STRING,
            "useCustomPrompt" to SafeValueKind.BOOLEAN,
            "customPrompt" to SafeValueKind.STRING,
        ),
        "modelPreferences" to mapOf(
            "recentModelSpecs" to SafeValueKind.STRING_ARRAY,
            "pinnedModelSpecs" to SafeValueKind.STRING_ARRAY,
        ),
        "ui" to mapOf("locale" to SafeValueKind.STRING),
    )

    fun projectSettings(raw: String): String = projectObject(raw, settingsFields)

    fun projectVibefly(raw: String): String {
        val root = parseObject(raw) ?: return "{}"
        val projected = linkedMapOf<String, JsonElement>()
        for ((group, fields) in vibeflyKeys) {
            when (val source = root[group]) {
                JsonNull -> projected[group] = JsonNull
                is JsonObject -> projected[group] = JsonObject(
                    source.filter { (key, value) ->
                        fields[key]?.let { kind -> kind.accepts(value) } == true
                    },
                )

                else -> Unit
            }
        }
        return encode(JsonObject(projected))
    }

    fun mergeSettings(current: String, projected: String): String =
        mergeObject(current, projected, settingsFields, SettingsDocument.SETTINGS.fileName)

    fun mergeVibefly(current: String, projected: String): String {
        val original = parseObject(current) ?: JsonObject(emptyMap())
        val incoming = parseIncomingObject(projected, SettingsDocument.VIBEFLY.fileName)
        val output = original.toMutableMap()
        for ((group, fields) in vibeflyKeys) {
            if (!incoming.containsKey(group)) continue
            when (val incomingGroup = incoming[group]) {
                JsonNull -> output[group] = JsonNull
                is JsonObject -> {
                    val currentGroup = (original[group] as? JsonObject)?.toMutableMap() ?: mutableMapOf()
                    for ((key, kind) in fields) {
                        if (!incomingGroup.containsKey(key)) continue
                        val value = incomingGroup.getValue(key)
                        if (!kind.accepts(value)) throw InvalidUiSettingsJsonException(
                            SettingsDocument.VIBEFLY.fileName,
                        )
                        currentGroup[key] = value
                    }
                    output[group] = JsonObject(currentGroup)
                }

                else -> throw InvalidUiSettingsJsonException(SettingsDocument.VIBEFLY.fileName)
            }
        }
        return encode(JsonObject(output))
    }

    private fun projectObject(raw: String, fields: Map<String, SafeValueKind>): String {
        val root = parseObject(raw) ?: return "{}"
        return encode(
            JsonObject(
                root.filter { (key, value) ->
                    fields[key]?.let { kind -> kind.accepts(value) } == true
                },
            ),
        )
    }

    private fun mergeObject(
        current: String,
        projected: String,
        fields: Map<String, SafeValueKind>,
        fileName: String,
    ): String {
        val original = parseObject(current)?.toMutableMap() ?: mutableMapOf()
        val incoming = parseIncomingObject(projected, fileName)
        for ((key, kind) in fields) {
            if (!incoming.containsKey(key)) continue
            val value = incoming.getValue(key)
            if (!kind.accepts(value)) throw InvalidUiSettingsJsonException(fileName)
            original[key] = value
        }
        return encode(JsonObject(original))
    }

    private fun parseObject(raw: String): JsonObject? = runCatching {
        Json.parseToJsonElement(raw).jsonObject
    }.getOrNull()

    private fun parseIncomingObject(raw: String, fileName: String): JsonObject = try {
        Json.parseToJsonElement(raw).jsonObject
    } catch (_: Exception) {
        throw InvalidUiSettingsJsonException(fileName)
    }

    private fun encode(value: JsonObject): String = json.encodeToString(JsonElement.serializer(), value) + "\n"

    private enum class SafeValueKind {
        STRING,
        BOOLEAN,
        STRING_ARRAY;

        fun accepts(value: JsonElement): Boolean = when {
            value === JsonNull -> true
            this == STRING -> value is JsonPrimitive && value.isString
            this == BOOLEAN -> value is JsonPrimitive && value.booleanOrNull != null
            else -> value is JsonArray && value.all { it is JsonPrimitive && it.isString }
        }
    }
}

internal class InvalidUiSettingsJsonException(fileName: String) :
    IllegalArgumentException("Invalid JSON for $fileName")
