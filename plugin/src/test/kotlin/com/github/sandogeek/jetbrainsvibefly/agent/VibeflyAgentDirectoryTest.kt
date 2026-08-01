package com.github.sandogeek.jetbrainsvibefly.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Path

class VibeflyAgentDirectoryTest {

    @Test
    fun testResolveUsesProductCodeUnderVibefly() {
        val home = System.getProperty("user.home") ?: ""
        val idea = VibeflyAgentDirectory.resolve("IU")
        val clion = VibeflyAgentDirectory.resolve("CL")
        val rider = VibeflyAgentDirectory.resolve("rd")

        assertEquals(Path.of(home, ".vibefly", "iu", "agent").normalize(), idea)
        assertEquals(Path.of(home, ".vibefly", "cl", "agent").normalize(), clion)
        assertEquals(Path.of(home, ".vibefly", "rd", "agent").normalize(), rider)
        assertNotEquals(idea, clion)
        assertNotEquals(clion, rider)
    }

    @Test
    fun testResolveEmptyFallsBackToUnknown() {
        val home = System.getProperty("user.home") ?: ""
        val path = VibeflyAgentDirectory.resolve("  ")
        assertEquals(Path.of(home, ".vibefly", "unknown", "agent").normalize(), path)
    }

    @Test
    fun testProductCodeIsNonBlank() {
        val code = VibeflyAgentDirectory.productCode()
        assertTrue(code.isNotBlank())
    }
}
