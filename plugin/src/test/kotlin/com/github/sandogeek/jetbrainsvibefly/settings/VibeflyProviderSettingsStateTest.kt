package com.github.sandogeek.jetbrainsvibefly.settings

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Pure unit tests (no IntelliJ platform) for settings bean helpers.
 */
class VibeflyProviderSettingsStateTest {

    @Test
    fun testDefaultModelSpec() {
        val state = VibeflyProviderSettingsState()
        assertEquals("", state.defaultModelSpec())
        state.defaultProvider = "openai"
        state.defaultModel = "gpt-4o-mini"
        assertEquals("openai/gpt-4o-mini", state.defaultModelSpec())
    }

    @Test
    fun testSnapshotAndCopy() {
        val a = VibeflyProviderSettingsState()
        a.defaultProvider = "openai"
        a.defaultModel = "gpt-4o"

        val b = a.snapshot()
        assertEquals("openai", b.defaultProvider)
        assertEquals("gpt-4o", b.defaultModel)

        b.defaultProvider = "anthropic"
        assertEquals("openai", a.defaultProvider)

        val c = VibeflyProviderSettingsState()
        c.copyFrom(a)
        assertEquals("gpt-4o", c.defaultModel)
    }

    @Test
    fun testIsModifiedFieldsIndependent() {
        val a = VibeflyProviderSettingsState()
        a.defaultProvider = "p"
        a.defaultModel = "m"
        assertEquals("p/m", a.defaultModelSpec())
        a.defaultProvider = ""
        assertEquals("", a.defaultModelSpec())
    }
}
