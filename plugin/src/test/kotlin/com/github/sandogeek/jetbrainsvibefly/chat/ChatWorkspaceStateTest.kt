package com.github.sandogeek.jetbrainsvibefly.chat

import com.github.sandogeek.vibefly.jcef.rpc.ChatWorkspaceStateDto
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatWorkspaceStateTest {
    @Test
    fun `replace normalizes order limit and active session`() {
        val state = ChatWorkspaceState()
        state.replace(
            ChatWorkspaceStateDto(
                sessionIds = listOf(" a ", "b", "a", "c", "d", "e", "f", "g", "h", "i"),
                activeSessionId = "b",
            ),
        )

        assertEquals(listOf("a", "b", "c", "d", "e", "f", "g", "h"), state.snapshot().sessionIds)
        assertEquals("b", state.snapshot().activeSessionId)
    }

    @Test
    fun `replace falls back to first open session`() {
        val state = ChatWorkspaceState()
        state.replace(ChatWorkspaceStateDto(sessionIds = listOf("a", "b"), activeSessionId = "missing"))
        assertEquals("a", state.snapshot().activeSessionId)
    }
}
