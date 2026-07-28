package com.github.sandogeek.vibefly.jcef

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VibeflyThemeTest {

    @Test
    fun currentMode_mapsDarkAndLight() {
        assertEquals(VibeflyTheme.Mode.DARK, VibeflyTheme.currentMode(isDark = true))
        assertEquals(VibeflyTheme.Mode.LIGHT, VibeflyTheme.currentMode(isDark = false))
    }

    @Test
    fun parseMode_acceptsDarkLightCaseInsensitive() {
        assertEquals(VibeflyTheme.Mode.DARK, VibeflyTheme.parseMode("dark"))
        assertEquals(VibeflyTheme.Mode.LIGHT, VibeflyTheme.parseMode("LIGHT"))
        assertNull(VibeflyTheme.parseMode("system"))
        assertNull(VibeflyTheme.parseMode(""))
    }
}
