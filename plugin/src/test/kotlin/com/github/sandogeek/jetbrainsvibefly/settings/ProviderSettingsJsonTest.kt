package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.CredentialAction
import com.github.sandogeek.vibefly.jcef.rpc.ProviderPatch
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersPatchRequest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test

class ProviderSettingsJsonTest {
    @Test
    fun `snapshot returns full provider JSON including unknown fields apiKey headers and URL query`() {
        val raw = snapshot(
            models =
                """{"providers":{"private":{"baseUrl":"https://user:password@example.test/v1?token=secret#private","api":"openai-completions","apiKey":"provider-level-key","headers":{"X-Custom":"h"},"custom":"keep","models":[{"id":"one","name":"One","compat":{"future":true}}]}}}""",
            auth = """{"private":{"type":"api_key","key":"super-secret"}}""",
        )

        val projected = ProviderSettingsJson.snapshot(raw)
        val provider = projected.providers.single()
        assertTrue(provider.credential.hasApiKey)
        assertNotNull(provider.configJson)
        val config = Json.parseToJsonElement(provider.configJson!!).jsonObject
        assertEquals(
            "https://user:password@example.test/v1?token=secret#private",
            config.getValue("baseUrl").jsonPrimitive.content,
        )
        assertEquals("provider-level-key", config.getValue("apiKey").jsonPrimitive.content)
        assertEquals("keep", config.getValue("custom").jsonPrimitive.content)
        assertEquals("h", config.getValue("headers").jsonObject.getValue("X-Custom").jsonPrimitive.content)
        // auth.json secret must not leak into the snapshot projection of credentials
        assertFalse(projected.toString().contains("super-secret"))
        // but provider config apiKey (models.json field) is intentionally visible
        assertTrue(provider.configJson!!.contains("provider-level-key"))
    }

    @Test
    fun `full JSON patch replaces provider entry and preserves unknown nested fields`() {
        val raw = snapshot(
            models =
                """{"top":"keep","providers":{"private":{"baseUrl":"https://old","api":"openai-responses","custom":"old","models":[{"id":"one","name":"Old"}]}}}""",
            auth = """{"other":{"type":"oauth","access":"preserve"}}""",
        )
        val configJson = """
            {
              "baseUrl": "https://new",
              "api": "openai-completions",
              "custom": "keep",
              "headers": {"X-A": "1"},
              "models": [
                {
                  "id": "one",
                  "name": "New",
                  "compat": {"future": true},
                  "maxTokens": 99,
                  "thinkingLevelMap": {"low": "x"},
                  "cost": {"input": 1, "output": 2, "cacheRead": 0, "cacheWrite": 0, "tiers": [{"upto": 1}]}
                },
                {"id": "two"}
              ]
            }
        """.trimIndent()
        val patched = ProviderSettingsJson.applyPatch(
            raw,
            ProvidersPatchRequest(
                providers = listOf(ProviderPatch(id = "private", configJson = configJson)),
                credentials = listOf(CredentialAction(provider = "private", action = "set", apiKey = "new-secret")),
            ),
        )

        assertTrue(patched.modelsJson.contains("\"top\""))
        assertTrue(patched.modelsJson.contains("https://new"))
        assertTrue(patched.modelsJson.contains("\"custom\""))
        assertTrue(patched.modelsJson.contains("\"future\": true"))
        assertTrue(patched.modelsJson.contains("\"maxTokens\": 99"))
        assertTrue(patched.modelsJson.contains("\"maxTokens\": 16384"))
        assertTrue(patched.modelsJson.contains("\"thinkingLevelMap\""))
        assertTrue(patched.modelsJson.contains("\"tiers\""))
        assertTrue(patched.modelsJson.contains("\"X-A\""))
        assertFalse(patched.modelsJson.contains("https://old"))
        assertTrue(patched.authJson.contains("\"other\""))
        assertTrue(patched.authJson.contains("new-secret"))

        val models = Json.parseToJsonElement(patched.modelsJson)
            .jsonObject
            .getValue("providers")
            .jsonObject
            .getValue("private")
            .jsonObject
            .getValue("models")
            .jsonArray
        assertEquals(2, models.size)
        assertEquals(128000, models[1].jsonObject.getValue("contextWindow").jsonPrimitive.content.toInt())
    }

    @Test
    fun `rejects non-object configJson duplicate model ids and bad field types`() {
        val raw = snapshot(models = """{"providers":{}}""", auth = "{}")

        assertThrows(IllegalArgumentException::class.java) {
            ProviderSettingsJson.applyPatch(
                raw,
                ProvidersPatchRequest(providers = listOf(ProviderPatch(id = "x", configJson = "[1]"))),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            ProviderSettingsJson.applyPatch(
                raw,
                ProvidersPatchRequest(
                    providers = listOf(
                        ProviderPatch(
                            id = "x",
                            configJson = """{"baseUrl":"https://a","api":"openai-completions","models":[{"id":"a"},{"id":"a"}]}""",
                        ),
                    ),
                ),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            ProviderSettingsJson.applyPatch(
                raw,
                ProvidersPatchRequest(
                    providers = listOf(
                        ProviderPatch(
                            id = "x",
                            configJson = """{"baseUrl":"https://a","api":"openai-completions","models":[{"id":"a","contextWindow":"big"}]}""",
                        ),
                    ),
                ),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            ProviderSettingsJson.applyPatch(
                raw,
                ProvidersPatchRequest(
                    providers = listOf(
                        ProviderPatch(
                            id = "x",
                            configJson = """{"models":[{"id":"a"}]}""",
                        ),
                    ),
                ),
            )
        }
    }

    @Test
    fun `credential-only and empty patches leave models document untouched`() {
        val models = """{"future":true}"""
        val raw = snapshot(models = models, auth = "{}")

        val credentialOnly = ProviderSettingsJson.applyPatch(
            raw,
            ProvidersPatchRequest(
                credentials = listOf(
                    CredentialAction(provider = "private", action = "set", apiKey = "secret"),
                ),
            ),
        )
        assertFalse(credentialOnly.modelsChanged)
        assertEquals(models, credentialOnly.modelsJson)
        assertTrue(credentialOnly.authChanged)

        val empty = ProviderSettingsJson.applyPatch(raw, ProvidersPatchRequest())
        assertFalse(empty.modelsChanged)
        assertFalse(empty.authChanged)
        assertEquals(models, empty.modelsJson)
        assertEquals("{}", empty.authJson)
    }

    @Test
    fun `removing a provider clears the models entry`() {
        val raw = snapshot(
            models = """{"providers":{"private":{"baseUrl":"https://a","api":"openai-completions","models":[{"id":"m"}]}}}""",
            auth = """{"private":{"type":"api_key","key":"k"}}""",
        )
        val patched = ProviderSettingsJson.applyPatch(
            raw,
            ProvidersPatchRequest(
                providers = listOf(ProviderPatch(id = "private", remove = true)),
                credentials = listOf(CredentialAction(provider = "private", action = "clear")),
            ),
        )
        val providers = Json.parseToJsonElement(patched.modelsJson).jsonObject["providers"]?.jsonObject
        assertTrue(providers == null || !providers.containsKey("private"))
        assertFalse(patched.authJson.contains("private"))
    }

    @Test
    fun `setting an API key preserves unknown fields on the same credential`() {
        val raw = snapshot(
            models = "{}",
            auth =
                """{"private":{"type":"api_key","key":"old-secret","future":{"refreshMode":"keep"},"version":7}}""",
        )

        val patched = ProviderSettingsJson.applyPatch(
            raw,
            ProvidersPatchRequest(
                credentials = listOf(
                    CredentialAction(provider = "private", action = "set", apiKey = "new-secret"),
                ),
            ),
        )

        val credential = Json.parseToJsonElement(patched.authJson)
            .jsonObject
            .getValue("private")
            .jsonObject
        assertEquals("api_key", credential.getValue("type").jsonPrimitive.content)
        assertEquals("new-secret", credential.getValue("key").jsonPrimitive.content)
        assertEquals("keep", credential.getValue("future").jsonObject.getValue("refreshMode").jsonPrimitive.content)
        assertEquals("7", credential.getValue("version").jsonPrimitive.content)
        assertFalse(patched.authJson.contains("old-secret"))
    }

    private fun snapshot(models: String, auth: String): SettingsScopeSnapshot = SettingsScopeSnapshot(
        scope = SETTINGS_SCOPE_APPLICATION,
        projectRoot = null,
        documents = mapOf(
            SettingsDocument.SETTINGS to EMPTY_JSON,
            SettingsDocument.VIBEFLY to EMPTY_JSON,
            SettingsDocument.MODELS to models,
            SettingsDocument.AUTH to auth,
        ),
        revision = "revision",
        diagnostics = emptyList(),
    )
}
