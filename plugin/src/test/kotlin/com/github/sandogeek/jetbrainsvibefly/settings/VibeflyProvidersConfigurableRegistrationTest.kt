package com.github.sandogeek.jetbrainsvibefly.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File

/**
 * Pure unit tests for configurable metadata and plugin.xml registration.
 * Avoids BasePlatformTestCase (coroutines NoSuchMethodError in this sandbox).
 */
class VibeflyProvidersConfigurableRegistrationTest {

    @Test
    fun testProvidersConfigurableDisplayName() {
        val configurable = VibeflyProvidersConfigurable()
        assertEquals("Providers", configurable.displayName)
        assertEquals("vibefly.providers", configurable.id)
    }

    @Test
    fun testParentConfigurableDisplayName() {
        val configurable = VibeflySettingsConfigurable()
        assertEquals("Vibe Fly", configurable.displayName)
        assertEquals("vibefly.settings", configurable.id)
        assertFalse(configurable.isModified)
    }

    @Test
    fun testPluginXmlRegistersConfigurables() {
        val pluginXml = File("src/main/resources/META-INF/plugin.xml")
        assertTrue("plugin.xml should exist", pluginXml.isFile)
        val text = pluginXml.readText()
        assertTrue(text.contains("id=\"vibefly.settings\""))
        assertTrue(text.contains("id=\"vibefly.providers\""))
        assertTrue(text.contains("VibeflySettingsConfigurable"))
        assertTrue(text.contains("VibeflyProvidersConfigurable"))
        assertTrue(text.contains("parentId=\"vibefly.settings\""))
    }

    private fun assertTrue(message: String, condition: Boolean) {
        org.junit.Assert.assertTrue(message, condition)
    }

    private fun assertTrue(condition: Boolean) {
        org.junit.Assert.assertTrue(condition)
    }
}
