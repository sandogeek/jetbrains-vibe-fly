package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.ProviderCredentialStatus
import com.github.sandogeek.vibefly.jcef.rpc.ProviderModelSnapshot
import com.github.sandogeek.vibefly.jcef.rpc.ProviderSnapshot
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ModelPickerFilterTest {

    @Before
    fun loadFixture() {
        BundledModelCatalog.loadFromJsonString(
            """
            {
              "providerOrder": ["anthropic", "openai", "zzz"],
              "providers": [
                {
                  "id": "anthropic",
                  "models": [
                    {
                      "id": "claude-sonnet",
                      "name": "Claude Sonnet 4",
                      "api": "anthropic-messages",
                      "contextWindow": 200000,
                      "vision": true,
                      "inputCostPerMTok": 3,
                      "outputCostPerMTok": 15,
                      "reasoning": true,
                      "priority": 2
                    },
                    {
                      "id": "claude-haiku",
                      "name": "Claude Haiku",
                      "contextWindow": 1000000,
                      "inputCostPerMTok": 0,
                      "outputCostPerMTok": 0,
                      "priority": 1
                    }
                  ]
                },
                {
                  "id": "openai",
                  "models": [
                    {
                      "id": "gpt-4o",
                      "name": "GPT-4o",
                      "contextWindow": 128000,
                      "inputCostPerMTok": 2.5,
                      "outputCostPerMTok": 10,
                      "priority": 5
                    }
                  ]
                }
              ]
            }
            """.trimIndent(),
        )
    }

    @After
    fun resetCatalog() {
        BundledModelCatalog.resetForTests()
    }

    @Test
    fun buildEntriesUsesCatalogAndCustomModels() {
        val snaps = listOf(
            ProviderSnapshot(
                id = "anthropic",
                isCatalog = true,
                credential = ProviderCredentialStatus(hasApiKey = true),
                models = emptyList(),
            ),
            ProviderSnapshot(
                id = "my-proxy",
                isCatalog = false,
                models = listOf(ProviderModelSnapshot(id = "demo", name = "Demo")),
            ),
            ProviderSnapshot(
                id = "openai",
                isCatalog = true,
                models = emptyList(),
            ),
        )
        val entries = ModelPickerFilter.buildEntries(snaps)
        val specs = entries.map { it.spec }
        assertTrue(specs.contains("anthropic/claude-sonnet"))
        assertTrue(specs.contains("my-proxy/demo"))
        assertFalse(specs.any { it.startsWith("openai/") }) // not connected
        val sonnet = entries.first { it.spec == "anthropic/claude-sonnet" }
        assertEquals(listOf("200K", "$3/$15", "reasoning"), sonnet.badges.take(3))
        assertTrue(sonnet.badges.size <= 3)
        val haiku = entries.first { it.spec == "anthropic/claude-haiku" }
        assertTrue(haiku.badges.contains("1M"))
        assertTrue(haiku.badges.contains("free"))
        val custom = entries.first { it.spec == "my-proxy/demo" }
        assertTrue(custom.badges.isEmpty())
    }

    @Test
    fun freeBadgeAndNullCostSkipped() {
        assertEquals("free", ModelPickerFilter.formatCostBadge(0.0, 0.0))
        assertNull(ModelPickerFilter.formatCostBadge(null, null))
        assertEquals("$3/$15", ModelPickerFilter.formatCostBadge(3.0, 15.0))
        assertEquals("$2.5/$10", ModelPickerFilter.formatCostBadge(2.5, 10.0))
    }

    @Test
    fun queryAndAndSlashMatching() {
        val entries = listOf(
            entry("anthropic", "Anthropic", "claude-sonnet", "Claude Sonnet 4", 0, 2),
            entry("anthropic", "Anthropic", "claude-haiku", "Claude Haiku", 0, 1),
            entry("openai", "OpenAI", "gpt-4o", "GPT-4o", 1, 5),
        )
        val andRows = ModelPickerFilter.rank(
            entries = entries,
            query = "claude 4",
            pinnedSpecs = emptyList(),
            recentSpecs = emptyList(),
            includeFollowDefault = false,
        )
        assertEquals(listOf("anthropic/claude-sonnet"), andRows.map { it.entry.spec })

        val slash = ModelPickerFilter.rank(
            entries = entries,
            query = "anthropic/sonnet",
            pinnedSpecs = emptyList(),
            recentSpecs = emptyList(),
            includeFollowDefault = false,
        )
        assertEquals(listOf("anthropic/claude-sonnet"), slash.map { it.entry.spec })
    }

    @Test
    fun tiersPinnedRecentAndProviderOrder() {
        val entries = listOf(
            entry("openai", "OpenAI", "gpt-4o", "GPT-4o", 1, 5),
            entry("anthropic", "Anthropic", "claude-sonnet", "Claude Sonnet 4", 0, 2),
            entry("anthropic", "Anthropic", "claude-haiku", "Claude Haiku", 0, 1),
        )
        val rows = ModelPickerFilter.rank(
            entries = entries,
            query = "",
            pinnedSpecs = listOf("openai/gpt-4o", "missing/x", "anthropic/claude-haiku"),
            recentSpecs = listOf("anthropic/claude-sonnet", "openai/gpt-4o"),
            includeFollowDefault = true,
        )
        // follow, pinned (intersection preserve order), recent (de-pin), normal by providerRank/priority
        assertEquals(ModelPickerTier.FOLLOW_DEFAULT, rows[0].tier)
        assertEquals("", rows[0].entry.spec)
        val pinned = rows.filter { it.tier == ModelPickerTier.PINNED }.map { it.entry.spec }
        assertEquals(listOf("openai/gpt-4o", "anthropic/claude-haiku"), pinned)
        val recent = rows.filter { it.tier == ModelPickerTier.RECENT }.map { it.entry.spec }
        assertEquals(listOf("anthropic/claude-sonnet"), recent)
        val normal = rows.filter { it.tier == ModelPickerTier.NORMAL }
        assertTrue(normal.isEmpty()) // all entries covered by pin/recent
    }

    @Test
    fun normalGroupOrderByProviderRankThenPriority() {
        val entries = listOf(
            entry("openai", "OpenAI", "gpt-4o", "GPT-4o", 1, 5),
            entry("anthropic", "Anthropic", "claude-sonnet", "Claude Sonnet 4", 0, 2),
            entry("anthropic", "Anthropic", "claude-haiku", "Claude Haiku", 0, 1),
        )
        val rows = ModelPickerFilter.rank(
            entries = entries,
            query = "",
            pinnedSpecs = emptyList(),
            recentSpecs = emptyList(),
            includeFollowDefault = false,
        )
        assertEquals(
            listOf(
                "anthropic/claude-haiku",
                "anthropic/claude-sonnet",
                "openai/gpt-4o",
            ),
            rows.map { it.entry.spec },
        )
        assertTrue(rows[0].isFirstInGroup)
        assertFalse(rows[1].isFirstInGroup)
        assertTrue(rows[2].isFirstInGroup)
    }

    @Test
    fun noMatchReturnsEmpty() {
        val entries = listOf(entry("openai", "OpenAI", "gpt-4o", "GPT-4o", 1, 5))
        val rows = ModelPickerFilter.rank(
            entries = entries,
            query = "zzzz-nope",
            pinnedSpecs = emptyList(),
            recentSpecs = emptyList(),
            includeFollowDefault = false,
        )
        assertTrue(rows.isEmpty())
    }

    @Test
    fun providerScopeFiltersEntriesAndKeepsFollowDefault() {
        val entries = listOf(
            entry("anthropic", "Anthropic", "claude-sonnet", "Claude Sonnet 4", 0, 2),
            entry("anthropic", "Anthropic", "claude-haiku", "Claude Haiku", 0, 1),
            entry("openai", "OpenAI", "gpt-4o", "GPT-4o", 1, 5),
            entry("openrouter", "OpenRouter", "claude-sonnet", "Claude Sonnet", 2, 3),
        )

        val openaiOnly = ModelPickerFilter.rank(
            entries = entries,
            query = "",
            pinnedSpecs = listOf("openai/gpt-4o", "anthropic/claude-haiku"),
            recentSpecs = listOf("openrouter/claude-sonnet"),
            includeFollowDefault = true,
            providerId = "openai",
        )
        assertEquals(ModelPickerTier.FOLLOW_DEFAULT, openaiOnly[0].tier)
        assertEquals(
            listOf("openai/gpt-4o"),
            openaiOnly.drop(1).map { it.entry.spec },
        )
        // Scoped list is single-provider — no NORMAL group header noise.
        assertTrue(openaiOnly.filter { it.tier == ModelPickerTier.NORMAL }.all { !it.isFirstInGroup })

        val openQuery = ModelPickerFilter.rank(
            entries = entries,
            query = "open",
            pinnedSpecs = emptyList(),
            recentSpecs = emptyList(),
            includeFollowDefault = false,
            providerId = "openai",
        )
        assertEquals(listOf("openai/gpt-4o"), openQuery.map { it.entry.spec })

        val allOpen = ModelPickerFilter.rank(
            entries = entries,
            query = "open",
            pinnedSpecs = emptyList(),
            recentSpecs = emptyList(),
            includeFollowDefault = false,
            providerId = null,
        )
        assertEquals(
            setOf("openai/gpt-4o", "openrouter/claude-sonnet"),
            allOpen.map { it.entry.spec }.toSet(),
        )
    }

    @Test
    fun listProvidersOrdersByRankThenLabel() {
        val entries = listOf(
            entry("openai", "OpenAI", "gpt-4o", "GPT-4o", 1, 5),
            entry("anthropic", "Anthropic", "claude-haiku", "Claude Haiku", 0, 1),
            entry("anthropic", "Anthropic", "claude-sonnet", "Claude Sonnet 4", 0, 2),
            entry("openrouter", "OpenRouter", "x", "X", 2, 1),
        )
        val providers = ModelPickerFilter.listProviders(entries)
        assertEquals(
            listOf("anthropic", "openai", "openrouter"),
            providers.map { it.id },
        )
        assertEquals("Anthropic", providers[0].label)
        assertTrue(ModelPickerFilter.listProviders(emptyList()).isEmpty())
    }

    private fun entry(
        providerId: String,
        providerLabel: String,
        modelId: String,
        modelLabel: String,
        providerRank: Int,
        priority: Int,
    ): ModelPickerEntry {
        val providerIdLower = providerId.lowercase()
        val providerLabelLower = providerLabel.lowercase()
        val modelIdLower = modelId.lowercase()
        val modelLabelLower = modelLabel.lowercase()
        return ModelPickerEntry(
            spec = "$providerId/$modelId",
            providerId = providerId,
            providerLabel = providerLabel,
            modelId = modelId,
            modelLabel = modelLabel,
            providerRank = providerRank,
            modelPriority = priority,
            badges = emptyList(),
            haystack = "$providerIdLower $providerLabelLower $modelIdLower $modelLabelLower",
            providerIdLower = providerIdLower,
            providerLabelLower = providerLabelLower,
            modelIdLower = modelIdLower,
            modelLabelLower = modelLabelLower,
        )
    }
}
