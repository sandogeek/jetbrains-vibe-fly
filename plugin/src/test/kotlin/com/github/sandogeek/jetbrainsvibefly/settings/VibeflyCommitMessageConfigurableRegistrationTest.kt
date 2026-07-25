package com.github.sandogeek.jetbrainsvibefly.settings

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * Pure unit tests for Commit Message configurable metadata and plugin.xml registration.
 */
class VibeflyCommitMessageConfigurableRegistrationTest {

    @Test
    fun testCommitMessageConfigurableDisplayName() {
        val configurable = VibeflyCommitMessageConfigurable()
        assertEquals("Commit Message", configurable.displayName)
        assertEquals("vibefly.commitMessage", configurable.id)
    }

    @Test
    fun testPluginXmlRegistersCommitMessageConfigurable() {
        val pluginXml = File("src/main/resources/META-INF/plugin.xml")
        assertTrue("plugin.xml should exist", pluginXml.isFile)
        val text = pluginXml.readText()
        assertTrue(text.contains("id=\"vibefly.commitMessage\""))
        assertTrue(text.contains("VibeflyCommitMessageConfigurable"))
        assertTrue(text.contains("parentId=\"vibefly.settings\""))
        assertTrue(text.contains("key=\"settings.commitMessage\""))
    }

    private fun assertTrue(message: String, condition: Boolean) {
        org.junit.Assert.assertTrue(message, condition)
    }

    private fun assertTrue(condition: Boolean) {
        org.junit.Assert.assertTrue(condition)
    }
}
