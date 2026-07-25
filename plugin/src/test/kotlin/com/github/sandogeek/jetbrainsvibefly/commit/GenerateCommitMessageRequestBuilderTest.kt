package com.github.sandogeek.jetbrainsvibefly.commit

import com.github.sandogeek.vibefly.jcef.rpc.CommitFileChange
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Pure unit tests for commit RPC request construction from settings fields.
 */
class GenerateCommitMessageRequestBuilderTest {

    @Test
    fun testToRequestCarriesModelLanguageAndCustomPrompt() {
        val collected = CommitDiffCollector.Collected(
            files = listOf(
                CommitFileChange(path = "a.kt", changeType = "MODIFIED", additions = 1),
            ),
            recentMessages = listOf("feat: prior"),
        )
        val request = collected.toRequest(
            style = "conventional_zh",
            commitModel = "  openai/gpt-4o-mini  ",
            defaultModel = " anthropic/claude-sonnet ",
            language = " zh ",
            customPrompt = "  Use short subjects  ",
        )
        assertEquals(1, request.files.size)
        assertEquals("conventional_zh", request.style)
        assertEquals(listOf("feat: prior"), request.recentMessages)
        assertEquals("openai/gpt-4o-mini", request.commitModel)
        assertEquals("anthropic/claude-sonnet", request.defaultModel)
        assertEquals("zh", request.language)
        assertEquals("Use short subjects", request.customPrompt)
    }

    @Test
    fun testToRequestOmitsBlankOptionalFields() {
        val collected = CommitDiffCollector.Collected(
            files = listOf(CommitFileChange(path = "a.kt", changeType = "ADDED")),
        )
        val request = collected.toRequest(
            commitModel = "  ",
            defaultModel = "",
            language = null,
            customPrompt = "   ",
        )
        assertNull(request.commitModel)
        assertNull(request.defaultModel)
        assertNull(request.language)
        assertNull(request.customPrompt)
    }
}
