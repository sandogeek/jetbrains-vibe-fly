package com.github.sandogeek.jetbrainsvibefly.commit

import com.github.sandogeek.jetbrainsvibefly.commit.RecentCommitCollector.Candidate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RecentCommitCollectorTest {

    @Test
    fun normalizeMessage_skipsMergeAndEmpty() {
        assertNull(RecentCommitCollector.normalizeMessage(null))
        assertNull(RecentCommitCollector.normalizeMessage("   "))
        assertNull(RecentCommitCollector.normalizeMessage("Merge branch 'main'"))
        assertEquals("feat: x", RecentCommitCollector.normalizeMessage("  feat: x  \n"))
    }

    @Test
    fun normalizeMessage_clampsLongBody() {
        val long = "feat: subject\n\n" + "a".repeat(1000)
        val out = RecentCommitCollector.normalizeMessage(long)!!
        assertTrue(out.length <= RecentCommitCollector.MAX_MESSAGE_CHARS + 3)
        assertTrue(out.endsWith("..."))
    }

    @Test
    fun normalizeMessage_keepsBodyWhenUnderLimit() {
        val msg = "feat: subject\n\nwhy this change"
        assertEquals(msg, RecentCommitCollector.normalizeMessage(msg))
    }

    @Test
    fun rankCandidates_ordersByCommitTimeAcrossRoots() {
        // Root A is first in iteration but has older commits; root B is newer.
        val candidates = listOf(
            Candidate("feat: from-root-a-old", commitTime = 100),
            Candidate("fix: from-root-a", commitTime = 200),
            Candidate("feat: from-root-b-newest", commitTime = 400),
            Candidate("chore: from-root-b", commitTime = 300),
        )
        val ranked = RecentCommitCollector.rankCandidates(candidates, limit = 3)
        assertEquals(
            listOf(
                "feat: from-root-b-newest",
                "chore: from-root-b",
                "fix: from-root-a",
            ),
            ranked,
        )
    }

    @Test
    fun rankCandidates_dedupesKeepingNewest() {
        val candidates = listOf(
            Candidate("feat: same", commitTime = 100),
            Candidate("feat: same", commitTime = 500),
            Candidate("fix: other", commitTime = 200),
        )
        val ranked = RecentCommitCollector.rankCandidates(candidates, limit = 10)
        assertEquals(listOf("feat: same", "fix: other"), ranked)
    }

    @Test
    fun rankCandidates_respectsLimit() {
        val candidates = (1..5).map { Candidate("msg-$it", commitTime = it.toLong()) }
        assertEquals(
            listOf("msg-5", "msg-4"),
            RecentCommitCollector.rankCandidates(candidates, limit = 2),
        )
    }
}
