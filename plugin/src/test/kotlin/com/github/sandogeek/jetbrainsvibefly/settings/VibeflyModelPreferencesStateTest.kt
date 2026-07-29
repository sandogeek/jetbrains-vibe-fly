package com.github.sandogeek.jetbrainsvibefly.settings

import org.junit.Assert.assertEquals
import org.junit.Test

class VibeflyModelPreferencesStateTest {

    @Test
    fun `replace trims deduplicates and caps recent models`() {
        val state = VibeflyModelPreferencesState()

        state.replace(
            recent = listOf(" a ", "", "b", "a", "c", "d", "e", "f", "g", "h", "i"),
            pinned = listOf(" x ", "", "y", "x"),
        )

        assertEquals(listOf("a", "b", "c", "d", "e", "f", "g", "h"), state.recentModelSpecs)
        assertEquals(listOf("x", "y"), state.pinnedModelSpecs)
    }
}
