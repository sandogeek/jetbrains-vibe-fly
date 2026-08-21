package com.github.sandogeek.jetbrainsvibefly.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Path

class SettingsFileOpenerTest {
    private val applicationDirectory = Path.of("/tmp/vibefly-app/agent")
    private val projectRoot = "/workspace/demo"

    @Test
    fun `resolves application settings files under the agent directory`() {
        val settings = resolve("application", "settings.json")
        assertTrue(settings.ok)
        assertEquals(SETTINGS_SCOPE_APPLICATION, settings.file?.scope)
        assertEquals(SettingsDocument.SETTINGS, settings.file?.document)
        assertEquals(
            applicationDirectory.toAbsolutePath().normalize().resolve("settings.json"),
            settings.file?.path,
        )

        val models = resolve(" application ", " models.json ")
        assertTrue(models.ok)
        assertEquals(SettingsDocument.MODELS, models.file?.document)
        assertEquals(
            applicationDirectory.toAbsolutePath().normalize().resolve("models.json"),
            models.file?.path,
        )
    }

    @Test
    fun `resolves project settings files under the project vibefly directory`() {
        val result = resolve("project", "settings.vibefly.json")
        assertTrue(result.ok)
        assertEquals(SETTINGS_SCOPE_PROJECT, result.file?.scope)
        assertEquals(SettingsDocument.VIBEFLY, result.file?.document)
        assertEquals(
            Path.of(projectRoot).toAbsolutePath().normalize()
                .resolve(PROJECT_SETTINGS_DIRECTORY_NAME)
                .resolve("settings.vibefly.json"),
            result.file?.path,
        )
    }

    @Test
    fun `rejects unknown scope and document names`() {
        val unknownScope = resolve("workspace", "settings.json")
        assertFalse(unknownScope.ok)
        assertNull(unknownScope.file)
        assertEquals("Unsupported settings scope: workspace", unknownScope.error)

        val unknownDocument = resolve("application", "secrets.json")
        assertFalse(unknownDocument.ok)
        assertEquals("secrets.json is not a settings document", unknownDocument.error)

        val blankDocument = resolve("application", "  ")
        assertFalse(blankDocument.ok)
        assertEquals("document is required", blankDocument.error)
    }

    @Test
    fun `rejects auth json and project models json`() {
        val applicationAuth = resolve("application", "auth.json")
        assertFalse(applicationAuth.ok)
        assertEquals("auth.json cannot be opened from the settings UI", applicationAuth.error)

        val projectAuth = resolve("project", "auth.json")
        assertFalse(projectAuth.ok)
        assertEquals("auth.json cannot be opened from the settings UI", projectAuth.error)

        val projectModels = resolve("project", "models.json")
        assertFalse(projectModels.ok)
        assertEquals("models.json is only supported for application scope", projectModels.error)
    }

    @Test
    fun `rejects project files without a project root`() {
        val missing = SettingsFileOpener.resolve(
            scope = "project",
            document = "settings.json",
            applicationDirectory = applicationDirectory,
            projectRoot = null,
        )
        assertFalse(missing.ok)
        assertEquals("Project has no valid base path", missing.error)

        val blank = SettingsFileOpener.resolve(
            scope = "project",
            document = "settings.json",
            applicationDirectory = applicationDirectory,
            projectRoot = "  ",
        )
        assertFalse(blank.ok)
        assertEquals("Project has no valid base path", blank.error)
    }

    private fun resolve(scope: String, document: String): SettingsFileResolveResult =
        SettingsFileOpener.resolve(
            scope = scope,
            document = document,
            applicationDirectory = applicationDirectory,
            projectRoot = projectRoot,
        )
}
