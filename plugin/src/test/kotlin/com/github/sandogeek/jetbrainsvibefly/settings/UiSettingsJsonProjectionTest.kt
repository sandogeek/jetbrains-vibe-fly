package com.github.sandogeek.jetbrainsvibefly.settings

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test

class UiSettingsJsonProjectionTest {
    @Test
    fun `projection omits secret-shaped invalid values and preserves safe null`() {
        val settings = UiSettingsJsonProjection.projectSettings(
            """{"defaultProvider":"openai","defaultModel":{"token":"sentinel-model"},"httpProxy":"sentinel-proxy"}""",
        )
        assertTrue(settings.contains("openai"))
        assertFalse(settings.contains("sentinel"))

        val vibefly = Json.parseToJsonElement(
            UiSettingsJsonProjection.projectVibefly(
                """{"commit":null,"modelPreferences":{"recentModelSpecs":["openai/model"],"pinnedModelSpecs":[{"token":"sentinel-array"}]}}""",
            ),
        ).jsonObject
        assertEquals(JsonNull, vibefly["commit"])
        assertTrue(vibefly.getValue("modelPreferences").jsonObject.containsKey("recentModelSpecs"))
        assertFalse(vibefly.toString().contains("sentinel"))
    }

    @Test
    fun `merge changes explicit fields without deleting hidden or null values`() {
        val settings = Json.parseToJsonElement(
            UiSettingsJsonProjection.mergeSettings(
                """{"defaultProvider":"old","defaultModel":{"future":true},"httpProxy":"sentinel-proxy"}""",
                """{"defaultProvider":"new"}""",
            ),
        ).jsonObject
        assertEquals("\"new\"", settings.getValue("defaultProvider").toString())
        assertTrue(settings.getValue("defaultModel").jsonObject.containsKey("future"))
        assertTrue(settings.toString().contains("sentinel-proxy"))

        val vibefly = Json.parseToJsonElement(
            UiSettingsJsonProjection.mergeVibefly(
                """{"commit":null,"ui":{"locale":"en"},"future":{"secret":"sentinel"}}""",
                """{"ui":{"locale":"zh"}}""",
            ),
        ).jsonObject
        assertEquals(JsonNull, vibefly["commit"])
        assertEquals("\"zh\"", vibefly.getValue("ui").jsonObject.getValue("locale").toString())
        assertTrue(vibefly.toString().contains("sentinel"))
    }

    @Test
    fun `invalid projected JSON is rejected instead of clearing fields`() {
        try {
            UiSettingsJsonProjection.mergeSettings("{\"defaultProvider\":\"old\"}", "[invalid")
            fail("Expected invalid projected JSON to be rejected")
        } catch (_: InvalidUiSettingsJsonException) {
        }

        try {
            UiSettingsJsonProjection.mergeVibefly("{}", "{\"commit\":\"invalid\"}")
            fail("Expected an invalid projected group to be rejected")
        } catch (_: InvalidUiSettingsJsonException) {
        }
    }
}
