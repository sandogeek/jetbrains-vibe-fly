package com.github.sandogeek.jetbrainsvibefly.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AddSelectionToVibeflyActionTest {
    @Test
    fun `truncateUtf8 respects the byte limit without splitting a character`() {
        val action = AddSelectionToVibeflyAction()
        val value = "abc你好吗"
        val truncated = action.truncateUtf8(value, 7)

        assertEquals("abc你", truncated)
        assertTrue(truncated.toByteArray(Charsets.UTF_8).size <= 7)
    }
}
