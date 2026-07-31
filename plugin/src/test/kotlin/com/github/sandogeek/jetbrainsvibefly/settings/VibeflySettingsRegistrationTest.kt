package com.github.sandogeek.jetbrainsvibefly.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Pure unit tests for settings host registration (plugin.xml + configurable metadata).
 * Avoids BasePlatformTestCase (coroutines NoSuchMethodError in this sandbox).
 */
class VibeflySettingsRegistrationTest {

    @Test
    fun testSingleSettingsConfigurableMetadata() {
        val configurable = VibeflySettingsConfigurable()
        assertEquals("Vibe Fly", configurable.displayName)
        assertEquals("vibefly.settings", configurable.id)
        assertFalse(configurable.isModified)
    }

    @Test
    fun testPluginXmlRegistersSingleConfigurableOnly() {
        val pluginXml = File("src/main/resources/META-INF/plugin.xml")
        assertTrue("plugin.xml should exist", pluginXml.isFile)
        val text = pluginXml.readText()
        assertTrue(text.contains("id=\"vibefly.settings\""))
        assertTrue(text.contains("VibeflySettingsConfigurable"))
        assertTrue(text.contains("parentId=\"tools\""))
        assertFalse(text.contains("id=\"vibefly.providers\""))
        assertFalse(text.contains("id=\"vibefly.commitMessage\""))
        assertFalse(text.contains("VibeflyProvidersConfigurable"))
        assertFalse(text.contains("VibeflyCommitMessageConfigurable"))
        assertFalse(text.contains("fileEditorProvider"))
        assertFalse(text.contains("VibeflySettingsFileEditorProvider"))
        assertFalse(text.contains("id=\"VibeFly.OpenSettings\""))
        assertFalse(text.contains("OpenVibeflySettingsAction"))
        assertFalse(text.contains("VibeflySettingsFileSystem"))
    }
}
