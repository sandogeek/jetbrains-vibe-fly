package com.github.sandogeek.vibefly.jcef

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VibeflyUiDevTest {

    @Test
    fun resolveStartUrl_defaultsToClasspathScheme() {
        assertEquals(
            VibeflyScheme.INDEX_URL,
            VibeflyUiDev.resolveStartUrl { null },
        )
        assertFalse(VibeflyUiDev.isEnabled { null })
    }

    @Test
    fun resolveStartUrl_devFlagUsesDefaultViteUrl() {
        val props = mapOf(VibeflyUiDev.DEV_ENABLED_PROPERTY to "true")
        assertTrue(VibeflyUiDev.isEnabled(props::get))
        assertEquals(
            VibeflyUiDev.DEFAULT_DEV_URL,
            VibeflyUiDev.resolveStartUrl(props::get),
        )
    }

    @Test
    fun resolveStartUrl_explicitUrlWins() {
        val props = mapOf(
            VibeflyUiDev.DEV_ENABLED_PROPERTY to "false",
            VibeflyUiDev.DEV_URL_PROPERTY to "http://127.0.0.1:5174",
        )
        assertTrue(VibeflyUiDev.isEnabled(props::get))
        assertEquals(
            "http://127.0.0.1:5174/",
            VibeflyUiDev.resolveStartUrl(props::get),
        )
    }

    @Test
    fun resolveStartUrl_ignoresInvalidDevFlag() {
        val props = mapOf(VibeflyUiDev.DEV_ENABLED_PROPERTY to "yes")
        assertFalse(VibeflyUiDev.isEnabled(props::get))
        assertEquals(
            VibeflyScheme.INDEX_URL,
            VibeflyUiDev.resolveStartUrl(props::get),
        )
    }
}
