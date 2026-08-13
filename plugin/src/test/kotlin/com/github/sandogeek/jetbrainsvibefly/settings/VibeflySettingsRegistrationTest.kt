package com.github.sandogeek.jetbrainsvibefly.settings

import com.intellij.icons.AllIcons
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileTypes.UnknownFileType
import com.intellij.testFramework.LightVirtualFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Pure unit tests for settings host registration (plugin.xml + editor provider).
 * Avoids BasePlatformTestCase (coroutines NoSuchMethodError in this sandbox).
 */
class VibeflySettingsRegistrationTest {

    @Test
    fun testSettingsFileEditorProviderMetadata() {
        val provider = VibeflySettingsFileEditorProvider()
        assertEquals("vibefly.settings.editor", provider.editorTypeId)
        assertEquals(FileEditorPolicy.HIDE_DEFAULT_EDITOR, provider.policy)
    }

    @Test
    fun testPluginXmlRegistersFileEditorProviderAndNoConfigurable() {
        val pluginXml = File("src/main/resources/META-INF/plugin.xml")
        assertTrue("plugin.xml should exist", pluginXml.isFile)
        val text = pluginXml.readText()
        assertTrue(text.contains("fileEditorProvider"))
        assertTrue(text.contains("VibeflySettingsFileEditorProvider"))
        assertTrue(text.contains("<fileType name=\"VibeflySettings\""))
        assertTrue(text.contains("com.github.sandogeek.jetbrainsvibefly.settings.VibeflySettingsFileType"))
        assertFalse(text.contains("applicationConfigurable"))
        assertFalse(text.contains("id=\"vibefly.settings\""))
        assertFalse(text.contains("VibeflySettingsConfigurable"))
        assertFalse(text.contains("parentId=\"tools\""))
        assertFalse(text.contains("id=\"vibefly.providers\""))
        assertFalse(text.contains("id=\"vibefly.commitMessage\""))
        assertFalse(text.contains("VibeflyProvidersConfigurable"))
        assertFalse(text.contains("VibeflyCommitMessageConfigurable"))
        assertFalse(text.contains("id=\"VibeFly.OpenSettings\""))
        assertFalse(text.contains("OpenVibeflySettingsAction"))
        assertFalse(text.contains("VibeflySettingsFileSystem"))
    }

    @Test
    fun testProviderRecognizesOnlyDedicatedSettingsVirtualFile() {
        val settingsFile = VibeflySettingsVirtualFile()
        val otherFile = LightVirtualFile("notes.txt", UnknownFileType.INSTANCE, "")
        assertTrue(VibeflySettingsVirtualFile.isSettingsFile(settingsFile))
        assertFalse(VibeflySettingsVirtualFile.isSettingsFile(otherFile))
    }

    @Test
    fun testSettingsVirtualFileUsesDedicatedFileTypeIcon() {
        val settingsFile = VibeflySettingsVirtualFile()
        assertSame(VibeflySettingsFileType, settingsFile.fileType)
        assertEquals(VibeflySettingsFileType.NAME, settingsFile.fileType.name)
        assertEquals(AllIcons.General.Settings, settingsFile.fileType.icon)
        assertTrue(VibeflySettingsFileType.isMyFileType(settingsFile))
        assertFalse(VibeflySettingsFileType.isMyFileType(LightVirtualFile("notes.txt")))
    }

    @Test
    fun testSettingsVirtualFileIdentityIsInstanceBased() {
        val first = VibeflySettingsVirtualFile()
        val second = VibeflySettingsVirtualFile()
        assertNotSame(first, second)
        assertSame(first, first)
    }
}
