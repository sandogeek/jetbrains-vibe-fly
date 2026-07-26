package com.github.sandogeek.jetbrainsvibefly.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Path

/**
 * Pure unit tests (no IntelliJ platform) for settings bean helpers.
 */
class VibeflyProviderSettingsStateTest {

    @Test
    fun testDefaultAgentDir() {
        val home = System.getProperty("user.home")
        val expected = Path.of(home, ".omp", "agent").toString()
        assertEquals(expected, VibeflyProviderSettingsState.defaultAgentDir())
    }

    @Test
    fun testExpandHome() {
        val home = System.getProperty("user.home")
        assertEquals(home, VibeflyProviderSettingsState.expandHome("~"))
        assertEquals(
            Path.of(home, "x", "y").toString(),
            VibeflyProviderSettingsState.expandHome("~/x/y"),
        )
        assertEquals("/abs/path", VibeflyProviderSettingsState.expandHome("/abs/path"))
    }

    @Test
    fun testResolvedAgentDirAndDefaultModelSpec() {
        val state = VibeflyProviderSettingsState()
        assertEquals(
            VibeflyProviderSettingsState.defaultAgentDir(),
            state.resolvedAgentDir(),
        )
        state.agentDir = "~/my-agent"
        assertTrue(state.resolvedAgentDir().endsWith("my-agent"))

        assertEquals("", state.defaultModelSpec())
        state.defaultProvider = "openai"
        state.defaultModel = "gpt-4o-mini"
        assertEquals("openai/gpt-4o-mini", state.defaultModelSpec())
    }

    @Test
    fun testSnapshotAndCopy() {
        val a = VibeflyProviderSettingsState()
        a.agentDir = "/tmp/a"
        a.defaultProvider = "openai"
        a.defaultModel = "gpt-4o"

        val b = a.snapshot()
        assertEquals("/tmp/a", b.agentDir)
        assertEquals("openai", b.defaultProvider)
        assertEquals("gpt-4o", b.defaultModel)

        b.agentDir = "/tmp/b"
        assertEquals("/tmp/a", a.agentDir)

        val c = VibeflyProviderSettingsState()
        c.copyFrom(a)
        assertEquals("/tmp/a", c.agentDir)
        assertEquals("gpt-4o", c.defaultModel)
    }

    @Test
    fun testIsModifiedFieldsIndependent() {
        val a = VibeflyProviderSettingsState()
        a.agentDir = ""
        a.defaultProvider = "p"
        a.defaultModel = "m"
        assertEquals("p/m", a.defaultModelSpec())
        a.defaultProvider = ""
        assertEquals("", a.defaultModelSpec())
    }
}
