package com.github.sandogeek.jetbrainsvibefly.settings

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BundledModelCatalogTest {

    @After
    fun reset() {
        BundledModelCatalog.resetForTests()
    }

    @Test
    fun loadsFixtureAndRanksProviders() {
        BundledModelCatalog.loadFromJsonString(
            """
            {
              "providerOrder": ["b", "a"],
              "providers": [
                {
                  "id": "a",
                  "models": [
                    { "id": "m1", "name": "Model 1", "contextWindow": 1000, "reasoning": true }
                  ]
                },
                {
                  "id": "b",
                  "models": [
                    { "id": "m2", "priority": 3, "toolsUnsupported": true, "vision": true }
                  ]
                }
              ]
            }
            """.trimIndent(),
        )
        assertEquals(listOf("a", "b"), BundledModelCatalog.providerIds())
        assertEquals(1, BundledModelCatalog.providerRank("a"))
        assertEquals(0, BundledModelCatalog.providerRank("b"))
        assertEquals(2, BundledModelCatalog.providerRank("unknown"))
        val m1 = BundledModelCatalog.models("a").single()
        assertEquals("Model 1", m1.name)
        assertTrue(m1.reasoning)
        assertEquals(1000, m1.contextWindow)
        val m2 = BundledModelCatalog.models("b").single()
        assertEquals("m2", m2.name) // defaults to id
        assertTrue(m2.vision)
        assertTrue(m2.toolsUnsupported)
        assertEquals(3, m2.priority)
    }
}
