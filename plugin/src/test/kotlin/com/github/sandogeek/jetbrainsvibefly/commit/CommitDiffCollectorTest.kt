package com.github.sandogeek.jetbrainsvibefly.commit

import com.github.sandogeek.jetbrainsvibefly.commit.CommitDiffCollector.LineChange
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CommitDiffCollectorTest {

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
                hunks = listOf("@@ -1 +1 @@\n+x\n"),
            ),
        )
        val collapsed = CommitDiffCollector.collapseOmittedGroups(files)
        assertEquals(2, collapsed.size)
        assertTrue(collapsed[0].path.contains("5 dependency lock"))
        assertEquals(CommitDiffCollector.Omitted.LOCKFILE, collapsed[0].omittedReason)
        assertEquals("src/Main.kt", collapsed[1].path)
        assertEquals(1, collapsed[1].hunks.size)
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
        assertEquals(
            "src/Main.kt",
            CommitDiffCollector.relativePath(null, "src/Main.kt"),
        )
        assertEquals(
            "/Users/me/project/src/Main.kt",
            CommitDiffCollector.relativePath(null, "/Users/me/project/src/Main.kt"),
        )
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
        assertFalse(bodyLines.any { it.drop(1) == "line-1" })
        assertFalse(bodyLines.any { it.drop(1) == "line-40" })
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
        assertTrue(built.hunks.isNotEmpty())
        assertTrue(built.hunks.any { it.render().contains("NEW_TAIL_MARKER_XYZ") })
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
        assertTrue(built.hunks.isNotEmpty())
    }

    @Test
    fun buildUnifiedDiff_hunksAreFullNotBudgetTruncated() {
        // Many small changes should all appear as separate/grouped hunks with no truncation marker.
        val before = (1..100).joinToString("\n") { "line-$it" } + "\n"
        val afterLines = (1..100).map { if (it % 20 == 0) "line-$it-changed" else "line-$it" }
        val after = afterLines.joinToString("\n") + "\n"
        val built = CommitDiffCollector.buildUnifiedDiff("many.kt", null, before, after)
        assertTrue(built.hunks.isNotEmpty())
        val joined = built.hunks.joinToString("") { it.render() }
        assertFalse(joined.contains("[truncated]"))
        // Every 20th line change should be present
        for (n in listOf(20, 40, 60, 80, 100)) {
            assertTrue(
                "missing change for line-$n",
                joined.contains("line-$n-changed"),
            )
        }
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
