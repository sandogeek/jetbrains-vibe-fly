package com.github.sandogeek.vibefly.jcef

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.awt.Color

class VibeflyThemeTest {

    @Test
    fun currentMode_mapsDarkAndLight() {
        assertEquals(VibeflyTheme.Mode.DARK, VibeflyTheme.currentMode(isDark = true))
        assertEquals(VibeflyTheme.Mode.LIGHT, VibeflyTheme.currentMode(isDark = false))
    }

    @Test
    fun toCssHex_opaqueAndAlpha() {
        assertEquals("#ff0000", VibeflyTheme.toCssHex(Color(255, 0, 0)))
        assertEquals("#00ff0080", VibeflyTheme.toCssHex(Color(0, 255, 0, 0x80)))
    }

    @Test
    fun applyScript_injectsStyleTagWithVfAndColorTokens() {
        val tokens = mapOf(
            "bg" to "#112233",
            "fg" to "#aabbcc",
            "accent" to "#0969da",
            "muted" to "#656d76",
            "surface" to "#f6f8fa",
            "border" to "#d0d7de",
        )
        val dark = VibeflyTheme.applyScript(VibeflyTheme.Mode.DARK, tokens)
        assertTrue(dark.contains("""setAttribute("${VibeflyTheme.ATTR}", "dark")"""))
        assertTrue(dark.contains("""colorScheme = "dark""""))
        assertTrue(dark.contains(VibeflyTheme.STYLE_ID))
        assertTrue(dark.contains("createElement(\"style\")"))
        assertTrue(dark.contains("""html[${VibeflyTheme.ATTR}="dark"]"""))
        assertTrue(dark.contains("--vf-bg:#112233"))
        assertTrue(dark.contains("--color-bg:#112233"))
        assertTrue(dark.contains("--vf-fg:#aabbcc"))
        assertTrue(dark.contains("--color-accent:#0969da"))
        assertTrue(dark.contains("background-color:#112233"))
        assertFalse(dark.contains("offsetHeight"))
        assertFalse(dark.contains("setProperty"))

        val light = VibeflyTheme.applyScript(VibeflyTheme.Mode.LIGHT, tokens)
        assertTrue(light.contains("""setAttribute("${VibeflyTheme.ATTR}", "light")"""))
        assertTrue(light.contains("""colorScheme = "light""""))
        assertTrue(light.contains("color-scheme:light"))
    }
}
