package com.github.sandogeek.jetbrainsvibefly.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VibeflyProjectSettingsServiceTest {
    @Test
    fun `project lock path is independent of IDE product code`() {
        val root = "/workspace/shared-project"

        val idea = VibeflyProjectSettingsService.projectLockPath(root, productCode = "iu")
        val clion = VibeflyProjectSettingsService.projectLockPath(root, productCode = "cl")

        assertEquals(idea, clion)
        assertTrue(idea.parent.endsWith("locks/projects"))
    }
}
