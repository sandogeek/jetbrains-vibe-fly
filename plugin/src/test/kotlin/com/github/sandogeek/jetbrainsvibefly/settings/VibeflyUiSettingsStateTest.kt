package com.github.sandogeek.jetbrainsvibefly.settings

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Pure unit tests (no IntelliJ platform) for UI settings helpers.
 */
class VibeflyUiSettingsStateTest {

    @Test
    fun testDefaults() {
        val state = VibeflyUiSettingsState()
        assertEquals(VibeflyUiSettingsState.LOCALE_FOLLOW_IDE, state.locale)
    }

    @Test
    fun testSnapshotAndCopy() {
        val a = VibeflyUiSettingsState()
        a.locale = VibeflyUiSettingsState.LOCALE_ZH

        val b = a.snapshot()
        assertEquals(VibeflyUiSettingsState.LOCALE_ZH, b.locale)

        b.locale = VibeflyUiSettingsState.LOCALE_EN
        assertEquals(VibeflyUiSettingsState.LOCALE_ZH, a.locale)

        val c = VibeflyUiSettingsState()
        c.copyFrom(a)
        assertEquals(VibeflyUiSettingsState.LOCALE_ZH, c.locale)
    }

    @Test
    fun testNormalizeLocale() {
        assertEquals(
            VibeflyUiSettingsState.LOCALE_EN,
            VibeflyUiSettingsState.normalizeLocale("English"),
        )
        assertEquals(
            VibeflyUiSettingsState.LOCALE_ZH,
            VibeflyUiSettingsState.normalizeLocale("zh-CN"),
        )
        assertEquals(
            VibeflyUiSettingsState.LOCALE_FOLLOW_IDE,
            VibeflyUiSettingsState.normalizeLocale("follow_ide"),
        )
        assertEquals(
            VibeflyUiSettingsState.LOCALE_FOLLOW_IDE,
            VibeflyUiSettingsState.normalizeLocale("unknown"),
        )
    }
}
