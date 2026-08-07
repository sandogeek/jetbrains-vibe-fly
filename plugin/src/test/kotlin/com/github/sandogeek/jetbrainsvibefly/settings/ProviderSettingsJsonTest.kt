package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.CredentialAction
import com.github.sandogeek.vibefly.jcef.rpc.ProviderModelPatch
import com.github.sandogeek.vibefly.jcef.rpc.ProviderPatch
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersPatchRequest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test

class ProviderSettingsJsonTest {
    @Test
    fun `safe projection exposes credential status without credential content or paths`() {
        val raw = snapshot(
            models =
                """{"providers":{"private":{"baseUrl":"https://user:password@example.test/v1?token=secret#private","custom":"keep"}}}""",
            auth = """{"private":{"type":"api_key","key":"super-secret"}}""",
        )

        val projected = ProviderSettingsJson.snapshot(raw)
        val provider = projected.providers.single()
        assertTrue(provider.credential.hasApiKey)
        assertEquals("https://example.test/v1", provider.baseUrl)
        assertEquals("", projected.agentDir)
        assertEquals(null, projected.modelsPath)
        assertFalse(projected.toString().contains("super-secret"))
        assertFalse(projected.toString().contains("password"))
        assertFalse(projected.toString().contains("token"))
    }

    @Test
    fun `semantic patch preserves unknown model and auth keys`() {
        val raw = snapshot(
            models =
                """{"top":"keep","providers":{"private":{"baseUrl":"https://old","api":"openai-responses","custom":"keep","models":[{"id":"one","name":"Old","compat":{"future":true},"maxTokens":99}]}}}""",
            auth = """{"other":{"type":"oauth","access":"preserve"}}""",
        )
        val patched = ProviderSettingsJson.applyPatch(
            raw,
            ProvidersPatchRequest(
                providers = listOf(
                    ProviderPatch(
                        id = "private",
                        baseUrl = "https://new",
                        models = listOf(
                            ProviderModelPatch(id = "one", name = "New"),
                            ProviderModelPatch(id = "two"),
                        ),
                    ),
                ),
                credentials = listOf(CredentialAction(provider = "private", action = "set", apiKey = "new-secret")),
            ),
        )

        assertTrue(patched.modelsJson.contains("\"top\""))
        assertTrue(patched.modelsJson.contains("\"custom\""))
        assertTrue(patched.modelsJson.contains("https://new"))
        assertTrue(patched.modelsJson.contains("\"future\": true"))
        assertTrue(patched.modelsJson.contains("\"maxTokens\": 99"))
        assertTrue(patched.modelsJson.contains("\"maxTokens\": 4096"))
        assertTrue(patched.authJson.contains("\"other\""))
        assertTrue(patched.authJson.contains("new-secret"))
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
