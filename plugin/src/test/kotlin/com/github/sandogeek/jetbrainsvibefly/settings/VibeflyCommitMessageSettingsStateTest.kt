package com.github.sandogeek.jetbrainsvibefly.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Pure unit tests (no IntelliJ platform) for commit message settings helpers.
 */
class VibeflyCommitMessageSettingsStateTest {

    @Test
    fun testDefaults() {
        val state = VibeflyCommitMessageSettingsState()
        assertEquals(VibeflyCommitMessageSettingsState.LANGUAGE_FOLLOW_IDE, state.languageMode)
        assertEquals("", state.commitModelSpec)
        assertEquals(false, state.useCustomPrompt)
        assertEquals("", state.customPrompt)
    }

    @Test
    fun testSnapshotAndCopy() {
        val a = VibeflyCommitMessageSettingsState()
        a.languageMode = VibeflyCommitMessageSettingsState.LANGUAGE_ZH
        a.commitModelSpec = "openai/gpt-4o-mini"
        a.useCustomPrompt = true
        a.customPrompt = "custom"

        val b = a.snapshot()
        assertEquals(VibeflyCommitMessageSettingsState.LANGUAGE_ZH, b.languageMode)
        assertEquals("openai/gpt-4o-mini", b.commitModelSpec)
        assertTrue(b.useCustomPrompt)
        assertEquals("custom", b.customPrompt)

        b.customPrompt = "other"
        assertEquals("custom", a.customPrompt)

        val c = VibeflyCommitMessageSettingsState()
        c.copyFrom(a)
        assertEquals("openai/gpt-4o-mini", c.commitModelSpec)
        assertEquals("custom", c.customPrompt)
    }

    @Test
    fun testResolveLanguageModes() {
        assertEquals("en", VibeflyCommitMessageSettingsState.resolveLanguage("en", Locale.US))
        assertEquals("zh", VibeflyCommitMessageSettingsState.resolveLanguage("zh", Locale.US))
        assertEquals(
            "zh",
            VibeflyCommitMessageSettingsState.resolveLanguage("follow_ide", Locale.SIMPLIFIED_CHINESE),
        )
        assertEquals(
            "en",
            VibeflyCommitMessageSettingsState.resolveLanguage("follow_ide", Locale.US),
        )
    }

    @Test
    fun testNormalizeLanguageMode() {
        assertEquals(
            VibeflyCommitMessageSettingsState.LANGUAGE_EN,
            VibeflyCommitMessageSettingsState.normalizeLanguageMode("English"),
        )
        assertEquals(
            VibeflyCommitMessageSettingsState.LANGUAGE_ZH,
            VibeflyCommitMessageSettingsState.normalizeLanguageMode("zh-CN"),
        )
        assertEquals(
            VibeflyCommitMessageSettingsState.LANGUAGE_FOLLOW_IDE,
            VibeflyCommitMessageSettingsState.normalizeLanguageMode("follow_ide"),
        )
        assertEquals(
            VibeflyCommitMessageSettingsState.LANGUAGE_FOLLOW_IDE,
            VibeflyCommitMessageSettingsState.normalizeLanguageMode("unknown"),
        )
    }

    @Test
    fun testResolvedCommitModelSpecFallsBackWhenInvalid() {
        val state = VibeflyCommitMessageSettingsState()
        state.commitModelSpec = "openai/gone"
        assertEquals("", state.resolvedCommitModelSpec(listOf("openai/gpt-4o-mini")))
        assertEquals(
            "openai/gpt-4o-mini",
            state.apply {
                commitModelSpec = "openai/gpt-4o-mini"
            }.resolvedCommitModelSpec(listOf("openai/gpt-4o-mini")),
        )
        assertEquals("", state.apply { commitModelSpec = "" }.resolvedCommitModelSpec(emptyList()))
    }

    @Test
    fun testResolvedCustomPrompt() {
        val state = VibeflyCommitMessageSettingsState()
        state.useCustomPrompt = false
        state.customPrompt = "  hello  "
        assertEquals("", state.resolvedCustomPrompt())

        state.useCustomPrompt = true
        assertEquals("hello", state.resolvedCustomPrompt())

        state.customPrompt = "   "
        assertEquals("", state.resolvedCustomPrompt())
    }
}
