package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.ProviderCredentialStatus
import com.github.sandogeek.vibefly.jcef.rpc.ProviderModelSnapshot
import com.github.sandogeek.vibefly.jcef.rpc.ProviderSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProviderUiHelpersTest {

    @Test
    fun displayNameUsesFriendlyMapAndFallback() {
        assertEquals("OpenAI", ProviderUiHelpers.displayName("openai"))
        assertEquals("Anthropic", ProviderUiHelpers.displayName("anthropic"))
        assertEquals("DeepSeek", ProviderUiHelpers.displayName("deepseek"))
        assertEquals("my-proxy", ProviderUiHelpers.displayName("my-proxy"))
    }

    @Test
    fun descriptionUsesMapAndDefaultFallback() {
        assertEquals(
            "Direct access to Claude models",
            ProviderUiHelpers.description("anthropic"),
        )
        assertEquals(
            "Bundled models from Oh My Pi catalog",
            ProviderUiHelpers.description("unknown-provider"),
        )
    }

    @Test
    fun classifyConnectedCustomAndCatalogWithCreds() {
        val custom = ProviderSnapshot(id = "my-proxy", isCatalog = false, isConfigured = true)
        val keyed = ProviderSnapshot(
            id = "openai",
            isCatalog = true,
            credential = ProviderCredentialStatus(hasApiKey = true, originKind = "api_key"),
        )
        val oauth = ProviderSnapshot(
            id = "anthropic",
            isCatalog = true,
            credential = ProviderCredentialStatus(hasOAuth = true, originKind = "oauth"),
        )
        // models.yml only, no credential → popular, not connected
        val configuredOnly = ProviderSnapshot(
            id = "deepseek",
            isCatalog = true,
            isConfigured = true,
        )
        val popularOnly = ProviderSnapshot(id = "groq", isCatalog = true)

        val result = ProviderUiHelpers.classifyProviders(
            listOf(custom, keyed, oauth, configuredOnly, popularOnly),
        )

        assertEquals(
            listOf("anthropic", "my-proxy", "openai"),
            result.connected.map { it.id },
        )
        assertEquals(listOf("deepseek", "groq"), result.popular.map { it.id })
    }

    @Test
    fun classifySortsByDisplayName() {
        val a = ProviderSnapshot(id = "z-custom", isCatalog = false)
        val b = ProviderSnapshot(
            id = "openai",
            isCatalog = true,
            credential = ProviderCredentialStatus(hasApiKey = true),
        )
        val c = ProviderSnapshot(
            id = "anthropic",
            isCatalog = true,
            credential = ProviderCredentialStatus(hasOAuth = true),
        )
        val result = ProviderUiHelpers.classifyProviders(listOf(a, b, c))
        assertEquals(listOf("anthropic", "openai", "z-custom"), result.connected.map { it.id })
    }

    @Test
    fun filterBuiltInProvidersMatchesIdNameAndDescriptionCaseInsensitively() {
        val providers = listOf(
            ProviderSnapshot(id = "openai", isCatalog = true),
            ProviderSnapshot(id = "deepseek", isCatalog = true),
            ProviderSnapshot(id = "custom-catalog", isCatalog = true),
        )

        assertEquals(
            listOf("openai"),
            ProviderUiHelpers.filterBuiltInProviders(providers, "OPENAI").map { it.id },
        )
        assertEquals(
            listOf("deepseek"),
            ProviderUiHelpers.filterBuiltInProviders(providers, "reasoner").map { it.id },
        )
        assertEquals(
            listOf("custom-catalog"),
            ProviderUiHelpers.filterBuiltInProviders(providers, "catalog").map { it.id },
        )
        assertEquals(
            providers,
            ProviderUiHelpers.filterBuiltInProviders(providers, "  "),
        )
    }

    @Test
    fun isConnectedRules() {
        assertTrue(
            ProviderUiHelpers.isConnected(
                ProviderSnapshot(id = "x", isCatalog = false),
            ),
        )
        assertTrue(
            ProviderUiHelpers.isConnected(
                ProviderSnapshot(
                    id = "openai",
                    isCatalog = true,
                    credential = ProviderCredentialStatus(hasApiKey = true),
                ),
            ),
        )
        assertTrue(
            ProviderUiHelpers.isConnected(
                ProviderSnapshot(
                    id = "anthropic",
                    isCatalog = true,
                    credential = ProviderCredentialStatus(hasOAuth = true),
                ),
            ),
        )
        assertFalse(
            ProviderUiHelpers.isConnected(
                ProviderSnapshot(id = "deepseek", isCatalog = true, isConfigured = true),
            ),
        )
        assertFalse(
            ProviderUiHelpers.isConnected(
                ProviderSnapshot(id = "groq", isCatalog = true),
            ),
        )
    }

    @Test
    fun primaryBadgePreference() {
        assertEquals(
            ProviderBadge.CUSTOM,
            ProviderUiHelpers.primaryBadge(ProviderSnapshot(id = "c", isCatalog = false)),
        )
        assertEquals(
            ProviderBadge.API_KEY,
            ProviderUiHelpers.primaryBadge(
                ProviderSnapshot(
                    id = "openai",
                    isCatalog = true,
                    credential = ProviderCredentialStatus(hasApiKey = true, hasOAuth = true),
                ),
            ),
        )
        assertEquals(
            ProviderBadge.OAUTH,
            ProviderUiHelpers.primaryBadge(
                ProviderSnapshot(
                    id = "anthropic",
                    isCatalog = true,
                    credential = ProviderCredentialStatus(hasOAuth = true),
                ),
            ),
        )
        assertEquals(
            ProviderBadge.CONFIGURED,
            ProviderUiHelpers.primaryBadge(
                ProviderSnapshot(id = "deepseek", isCatalog = true, isConfigured = true),
            ),
        )
    }

    @Test
    fun badgeLabels() {
        assertEquals("CUSTOM", ProviderUiHelpers.badgeLabel(ProviderBadge.CUSTOM))
        assertEquals("API KEY", ProviderUiHelpers.badgeLabel(ProviderBadge.API_KEY))
        assertEquals("OAUTH", ProviderUiHelpers.badgeLabel(ProviderBadge.OAUTH))
        assertEquals("CONFIGURED", ProviderUiHelpers.badgeLabel(ProviderBadge.CONFIGURED))
    }

    @Test
    fun customProviderModelsParseFormat() {
        val text = """
            gpt-4o | GPT-4o | openai-completions
            o1
            # comment
            custom | | anthropic-messages
        """.trimIndent()
        val models = CustomProviderDialog.parseModelsText(text)
        assertEquals(3, models.size)
        assertEquals("gpt-4o", models[0].id)
        assertEquals("GPT-4o", models[0].name)
        assertEquals("openai-completions", models[0].api)
        assertEquals("o1", models[1].id)
        assertEquals("custom", models[2].id)
        assertEquals("anthropic-messages", models[2].api)

        val formatted = CustomProviderDialog.formatModels(models)
        assertTrue(formatted.contains("gpt-4o | GPT-4o | openai-completions"))
        assertTrue(formatted.contains("o1"))
    }

    @Test
    fun connectedModelSpecsOnlyFromConnectedProviders() {
        BundledModelCatalog.loadFromJsonString(
            """
            {
              "providerOrder": ["openai", "groq"],
              "providers": [
                {
                  "id": "openai",
                  "models": [
                    { "id": "gpt-4o" },
                    { "id": "gpt-4o-mini" }
                  ]
                },
                {
                  "id": "groq",
                  "models": [
                    { "id": "llama-3" }
                  ]
                }
              ]
            }
            """.trimIndent(),
        )
        try {
            val connected = ProviderSnapshot(
                id = "openai",
                isCatalog = true,
                credential = ProviderCredentialStatus(hasApiKey = true),
                models = emptyList(),
            )
            val popular = ProviderSnapshot(
                id = "groq",
                isCatalog = true,
                models = emptyList(),
            )
            val custom = ProviderSnapshot(
                id = "my-proxy",
                isCatalog = false,
                models = listOf(ProviderModelSnapshot(id = "demo")),
            )
            val specs = ProviderUiHelpers.connectedModelSpecs(listOf(connected, popular, custom))
            assertEquals(
                listOf("my-proxy/demo", "openai/gpt-4o", "openai/gpt-4o-mini"),
                specs,
            )
            assertFalse(specs.any { it.startsWith("groq/") })
        } finally {
            BundledModelCatalog.resetForTests()
        }
    }

    @Test
    fun connectedModelSpecsFallsBackToCatalogWhenSnapshotModelsEmpty() {
        BundledModelCatalog.loadFromJsonString(
            """
            {
              "providerOrder": ["anthropic", "groq"],
              "providers": [
                {
                  "id": "anthropic",
                  "models": [
                    { "id": "claude-sonnet" },
                    { "id": "claude-opus" }
                  ]
                },
                {
                  "id": "groq",
                  "models": [
                    { "id": "llama-3" }
                  ]
                }
              ]
            }
            """.trimIndent(),
        )
        try {
            val connected = ProviderSnapshot(
                id = "anthropic",
                isCatalog = true,
                credential = ProviderCredentialStatus(hasOAuth = true),
                models = emptyList(),
            )
            val specs = ProviderUiHelpers.connectedModelSpecs(listOf(connected))
            assertEquals(listOf("anthropic/claude-sonnet", "anthropic/claude-opus"), specs)
        } finally {
            BundledModelCatalog.resetForTests()
        }
    }

    @Test
    fun resolveDefaultModelSpecPrefersValidThenAutoPicks() {
        val options = listOf("openai/gpt-4o", "openai/gpt-4o-mini", "my-proxy/demo")
        assertEquals(
            "openai/gpt-4o-mini",
            ProviderUiHelpers.resolveDefaultModelSpec("openai", "gpt-4o-mini", options),
        )
        assertEquals(
            "",
            ProviderUiHelpers.resolveDefaultModelSpec("groq", "llama-3", options, autoPick = false),
        )
        assertEquals(
            "openai/gpt-4o",
            ProviderUiHelpers.resolveDefaultModelSpec("groq", "llama-3", options, autoPick = true),
        )
        assertEquals(
            "openai/gpt-4o",
            ProviderUiHelpers.resolveDefaultModelSpec("", "", options, autoPick = true),
        )
        assertEquals(
            "",
            ProviderUiHelpers.resolveDefaultModelSpec("", "", emptyList(), autoPick = true),
        )
    }

    @Test
    fun modelSpecAndParseRoundTrip() {
        assertEquals("openai/gpt-4o", ProviderUiHelpers.modelSpec("openai", "gpt-4o"))
        assertEquals("", ProviderUiHelpers.modelSpec("", "gpt-4o"))
        assertEquals("" to "", ProviderUiHelpers.parseModelSpec(""))
        assertEquals("openai" to "gpt-4o", ProviderUiHelpers.parseModelSpec("openai/gpt-4o"))
        assertEquals("openai" to "gpt-4o/turbo", ProviderUiHelpers.parseModelSpec("openai/gpt-4o/turbo"))
    }
}
