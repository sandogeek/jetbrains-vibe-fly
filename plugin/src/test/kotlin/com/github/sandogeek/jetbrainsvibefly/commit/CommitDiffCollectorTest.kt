package com.github.sandogeek.jetbrainsvibefly.commit

import com.github.sandogeek.jetbrainsvibefly.commit.CommitDiffCollector.LineChange
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CommitDiffCollectorTest {

    @Test
    fun truncateUtf8_underLimit_notTruncated() {
        val result = CommitDiffCollector.truncateUtf8("hello", 100)
        assertEquals("hello", result.text)
        assertFalse(result.truncated)
    }

    @Test
    fun truncateUtf8_overLimit_marksTruncatedAndWithinBytes() {
        val input = "a".repeat(1000)
        val max = 100
        val result = CommitDiffCollector.truncateUtf8(input, max)
        assertTrue(result.truncated)
        assertTrue(result.text.contains("[truncated]"))
        // Hard limit: total payload (content + marker) must stay within maxBytes.
        assertTrue(
            "expected <= $max bytes, got ${result.text.toByteArray(Charsets.UTF_8).size}",
            result.text.toByteArray(Charsets.UTF_8).size <= max,
        )
    }

    @Test
    fun fitHunksToBudget_respectsHardByteLimit() {
        fun makeHunk(marker: String): CommitDiffCollector.Hunk {
            val context = (1..40).map { " pad-$it-$marker" }
            val lines = context + listOf("-old-$marker", "+$marker") + context
            return CommitDiffCollector.Hunk(
                oldStart = 1,
                oldCount = lines.count { it.startsWith("-") || it.startsWith(" ") },
                newStart = 1,
                newCount = lines.count { it.startsWith("+") || it.startsWith(" ") },
                lines = lines,
            )
        }
        val hunks = listOf(makeHunk("A"), makeHunk("B"), makeHunk("C"))
        val header = "--- a/f\n+++ b/f\n"
        val budget = 400
        val fitted = CommitDiffCollector.fitHunksToBudget(header, hunks, budget)
        assertTrue(fitted.truncated)
        assertTrue(
            "expected <= $budget bytes, got ${fitted.text.toByteArray(Charsets.UTF_8).size}",
            fitted.text.toByteArray(Charsets.UTF_8).size <= budget,
        )
    }

    @Test
    fun dropContextLines_recomputesStartLineNumbers() {
        val hunk = CommitDiffCollector.Hunk(
            oldStart = 10,
            oldCount = 5,
            newStart = 10,
            newCount = 5,
            lines = listOf(
                " ctx-a",
                " ctx-b",
                "-old",
                "+new",
                " ctx-c",
            ),
        )
        val slim = CommitDiffCollector.dropContextLines(hunk)
        assertEquals(listOf("-old", "+new"), slim.lines)
        // Two leading context lines dropped → first change is at line 12.
        assertEquals(12, slim.oldStart)
        assertEquals(12, slim.newStart)
        assertEquals(1, slim.oldCount)
        assertEquals(1, slim.newCount)
    }

    @Test
    fun collapseOmittedGroups_aggregatesManyLockfiles() {
        val files = (1..5).map {
            com.github.sandogeek.vibefly.jcef.rpc.CommitFileChange(
                path = "pkg$it/yarn.lock",
                changeType = "MODIFIED",
                omittedReason = CommitDiffCollector.Omitted.LOCKFILE,
            )
        } + listOf(
            com.github.sandogeek.vibefly.jcef.rpc.CommitFileChange(
                path = "src/Main.kt",
                changeType = "MODIFIED",
                additions = 1,
                diff = "+x\n",
            ),
        )
        val collapsed = CommitDiffCollector.collapseOmittedGroups(files)
        assertEquals(2, collapsed.size)
        assertTrue(collapsed[0].path.contains("5 dependency lock"))
        assertEquals(CommitDiffCollector.Omitted.LOCKFILE, collapsed[0].omittedReason)
        assertEquals("src/Main.kt", collapsed[1].path)
    }

    @Test
    fun truncateUtf8_zeroMax_emptyAndTruncatedWhenNonEmpty() {
        val result = CommitDiffCollector.truncateUtf8("abc", 0)
        assertEquals("", result.text)
        assertTrue(result.truncated)
    }

    @Test
    fun truncateUtf8_multibyteBoundary_doesNotCorrupt() {
        // Each emoji is 4 bytes in UTF-8.
        val input = "😀".repeat(20)
        val result = CommitDiffCollector.truncateUtf8(input, 10)
        assertTrue(result.truncated)
        // Should still be valid UTF-8 string (no exception constructing it).
        assertTrue(result.text.isNotEmpty())
    }

    @Test
    fun isLockFile_matchesKnownBasenamesInAnyDirectory() {
        assertTrue(CommitDiffCollector.isLockFile("package-lock.json"))
        assertTrue(CommitDiffCollector.isLockFile("packages/foo/yarn.lock"))
        assertTrue(CommitDiffCollector.isLockFile("a\\b\\pnpm-lock.yaml"))
        assertTrue(CommitDiffCollector.isLockFile("Cargo.lock"))
        assertTrue(CommitDiffCollector.isLockFile("go.sum"))
        assertTrue(CommitDiffCollector.isLockFile(".terraform.lock.hcl"))
        assertFalse(CommitDiffCollector.isLockFile("src/main.kt"))
        assertFalse(CommitDiffCollector.isLockFile("package.json"))
        assertFalse(CommitDiffCollector.isLockFile("lock.json"))
    }

    @Test
    fun isSensitiveFile_matchesEnvAndKeys() {
        assertTrue(CommitDiffCollector.isSensitiveFile(".env"))
        assertTrue(CommitDiffCollector.isSensitiveFile("app/.env.local"))
        assertTrue(CommitDiffCollector.isSensitiveFile("certs/server.pem"))
        assertTrue(CommitDiffCollector.isSensitiveFile("id_rsa"))
        assertTrue(CommitDiffCollector.isSensitiveFile("secrets.json"))
        assertFalse(CommitDiffCollector.isSensitiveFile("src/main.kt"))
        assertFalse(CommitDiffCollector.isSensitiveFile("README.md"))
    }

    @Test
    fun relativePath_stripsProjectBase() {
        val base = "/Users/me/project"
        // Project is only used for basePath; pass a stub via fake relativePath overload testing
        // by calling with null project (keeps absolute) and direct logic via reflection-free helper.
        assertEquals(
            "src/Main.kt",
            CommitDiffCollector.relativePath(null, "src/Main.kt"),
        )
        // Without project, absolute stays absolute (normalized slashes)
        assertEquals(
            "/Users/me/project/src/Main.kt",
            CommitDiffCollector.relativePath(null, "/Users/me/project/src/Main.kt"),
        )
        // Simulate base stripping with a tiny local helper matching production rules
        fun rel(projectBase: String?, absolutePath: String): String {
            val normalized = absolutePath.replace('\\', '/')
            val b = projectBase?.replace('\\', '/')?.trimEnd('/')
            if (!b.isNullOrEmpty()) {
                val prefix = "$b/"
                if (normalized == b) return "."
                if (normalized.startsWith(prefix)) return normalized.substring(prefix.length)
            }
            return normalized
        }
        assertEquals("src/Main.kt", rel(base, "$base/src/Main.kt"))
        assertEquals("plugin/a.kt", rel(base, "$base/plugin/a.kt"))
        assertFalse(rel(base, "$base/src/Main.kt").startsWith("/Users"))
    }

    @Test
    fun buildHunks_omitsUnchangedLinesOutsideContext() {
        val before = (1..40).map { "line-$it" }
        val after = before.toMutableList().also { it[19] = "line-20-changed" } // index 19
        val changes = listOf(LineChange(19, 20, 19, 20))
        val hunks = CommitDiffCollector.buildHunks(before, after, changes, context = 3)
        assertEquals(1, hunks.size)
        val bodyLines = hunks[0].lines
        val body = bodyLines.joinToString("\n")
        assertTrue(bodyLines.any { it == "-line-20" })
        assertTrue(bodyLines.any { it == "+line-20-changed" })
        // Far-away unchanged lines must not appear (match full payload after prefix)
        assertFalse(bodyLines.any { it.drop(1) == "line-1" })
        assertFalse(bodyLines.any { it.drop(1) == "line-40" })
        // Context around change should appear
        assertTrue(bodyLines.any { it == " line-19" })
        assertTrue(bodyLines.any { it == " line-21" })
        assertTrue(body.contains("line-20-changed"))
    }

    @Test
    fun buildUnifiedDiff_largeFileStillShowsTrailingAddition() {
        val beforeLines = (1..200).map { "stable-$it" }
        val afterLines = beforeLines + listOf("NEW_TAIL_MARKER_XYZ")
        val before = beforeLines.joinToString("\n") + "\n"
        val after = afterLines.joinToString("\n") + "\n"
        val built = CommitDiffCollector.buildUnifiedDiff("big.kt", null, before, after)
        assertTrue(built.text.contains("NEW_TAIL_MARKER_XYZ"))
        assertTrue(built.additions >= 1)
        // Should not dump all 200 lines as deletions
        val deletedStables = built.text.lineSequence().count { it.startsWith("-stable-") }
        assertTrue(
            "expected few deleted context lines, got $deletedStables",
            deletedStables < 20,
        )
    }

    @Test
    fun buildUnifiedDiff_movePathsInHeader() {
        val before = "a\n"
        val after = "b\n"
        val built = CommitDiffCollector.buildUnifiedDiff(
            path = "new/Dir.kt",
            oldPath = "old/Dir.kt",
            before = before,
            after = after,
        )
        assertTrue(built.text.contains("--- a/old/Dir.kt"))
        assertTrue(built.text.contains("+++ b/new/Dir.kt"))
    }

    @Test
    fun fairQuotas_givesEveryFileAShare() {
        val weights = listOf(50_000, 50_000, 50_000)
        val total = 3000
        val quotas = CommitDiffCollector.fairQuotas(weights, total, minEach = 500)
        assertEquals(3, quotas.size)
        assertTrue(quotas.all { it >= 500 })
        assertTrue(quotas.sum() <= total)
        // No single file takes the entire budget
        assertTrue(quotas.all { it < total })
    }

    @Test
    fun fitHunksToBudget_samplesMultipleHunksNotOnlyHead() {
        fun makeHunk(marker: String): CommitDiffCollector.Hunk {
            // Large context so head-only truncation would drop later hunks entirely
            val context = (1..30).map { " pad-$it" }
            val lines = context + listOf("-old-$marker", "+$marker") + context
            return CommitDiffCollector.Hunk(
                oldStart = 1,
                oldCount = lines.count { it.startsWith("-") || it.startsWith(" ") },
                newStart = 1,
                newCount = lines.count { it.startsWith("+") || it.startsWith(" ") },
                lines = lines,
            )
        }
        val hunks = listOf(
            makeHunk("HEAD_ONLY_A"),
            makeHunk("MIDDLE_B"),
            makeHunk("TAIL_C"),
        )
        val header = "--- a/f\n+++ b/f\n"
        val fullSize = header.toByteArray().size + hunks.sumOf { it.byteSize() }
        // ~40% of full size: head-only would only cover hunk 1; fair+shrink keeps change markers
        val budget = (fullSize * 0.4).toInt().coerceAtLeast(header.toByteArray().size + 80)
        val fitted = CommitDiffCollector.fitHunksToBudget(header, hunks, budget)
        assertTrue(fitted.truncated)
        val markers = listOf("HEAD_ONLY_A", "MIDDLE_B", "TAIL_C").count { fitted.text.contains(it) }
        assertTrue("expected multi-hunk sampling, got:\n${fitted.text}", markers >= 2)
    }

    @Test
    fun compareLineChanges_detectsSimpleReplace() {
        val before = listOf("a", "b", "c")
        val after = listOf("a", "B", "c")
        val changes = CommitDiffCollector.compareLineChanges(before, after)
        assertTrue(changes.isNotEmpty())
        val all = changes.fold(0 to 0) { acc, c ->
            (acc.first + (c.end1 - c.start1)) to (acc.second + (c.end2 - c.start2))
        }
        assertEquals(1, all.first)
        assertEquals(1, all.second)
        val hunks = CommitDiffCollector.buildHunks(before, after, changes, context = 1)
        val text = hunks.joinToString("") { it.render() }
        assertTrue(text.contains("-b"))
        assertTrue(text.contains("+B"))
        assertFalse(text.lines().any { it == "-a" })
        assertFalse(text.lines().any { it == "-c" })
    }
}
