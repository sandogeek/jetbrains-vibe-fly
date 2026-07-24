package com.github.sandogeek.jetbrainsvibefly.commit

import com.github.sandogeek.vibefly.jcef.rpc.CommitFileChange
import com.github.sandogeek.vibefly.jcef.rpc.GenerateCommitMessageRequest
import com.intellij.diff.comparison.ByLineRt
import com.intellij.diff.comparison.CancellationChecker
import com.intellij.diff.comparison.ComparisonManager
import com.intellij.diff.comparison.ComparisonPolicy
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.progress.EmptyProgressIndicator
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.project.Project
import com.intellij.openapi.vcs.VcsException
import com.intellij.openapi.vcs.changes.Change
import com.intellij.openapi.vcs.changes.ContentRevision
import java.util.Locale

/**
 * Builds per-file summaries + full unified hunks for commit message generation.
 * Host does not budget/truncate diffs; the agent decides inclusion from model context.
 * Uses platform VCS Change content (no Git4Idea dependency).
 */
object CommitDiffCollector {

    const val HUNK_CONTEXT_LINES: Int = 3

    private val log = logger<CommitDiffCollector>()

    /**
     * Dependency lock / resolve files whose diffs are large and low-signal for commit messages.
     * Matched by basename only (any directory).
     */
    internal val LOCK_FILE_NAMES: Set<String> = setOf(
        // JavaScript / Node.js
        "package-lock.json",
        "npm-shrinkwrap.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "shrinkwrap.yaml",
        "bun.lockb",
        "bun.lock",
        ".pnp.js",
        ".pnp.cjs",
        "jspm.lock",
        // Python
        "Pipfile.lock",
        "poetry.lock",
        "pdm.lock",
        ".pdm-lock.toml",
        "uv.lock",
        "conda-lock.yml",
        "pylock.toml",
        // Ruby
        "Gemfile.lock",
        // PHP
        "composer.lock",
        // Java / JVM
        "gradle.lockfile",
        "lockfile.json",
        "dependency-lock.json",
        "dependency-reduced-pom.xml",
        "coursier.lock",
        // Scala
        "build.sbt.lock",
        // .NET
        "packages.lock.json",
        "paket.lock",
        "project.assets.json",
        // Rust
        "Cargo.lock",
        // Go
        "go.sum",
        "Gopkg.lock",
        "glide.lock",
        // Zig
        "build.zig.zon.lock",
        // OCaml
        "dune.lock",
        "opam.lock",
        // Swift / iOS
        "Package.resolved",
        "Podfile.lock",
        "Cartfile.resolved",
        // Dart / Flutter
        "pubspec.lock",
        // Elixir / Erlang
        "mix.lock",
        "rebar.lock",
        // Haskell
        "stack.yaml.lock",
        "cabal.project.freeze",
        // Elm
        "exact-dependencies.json",
        // Crystal
        "shard.lock",
        // Julia
        "Manifest.toml",
        "JuliaManifest.toml",
        // R
        "renv.lock",
        "packrat.lock",
        // Nim
        "nimble.lock",
        // D
        "dub.selections.json",
        // Lua
        "rocks.lock",
        // Perl
        "carton.lock",
        "cpanfile.snapshot",
        // C/C++
        "conan.lock",
        "vcpkg-lock.json",
        // Infrastructure as Code
        ".terraform.lock.hcl",
        "Berksfile.lock",
        "Puppetfile.lock",
        "MODULE.bazel.lock",
        // Nix
        "flake.lock",
        // Deno
        "deno.lock",
        // DevContainers
        "devcontainer.lock.json",
    )

    private val SENSITIVE_BASENAME_EXACT: Set<String> = setOf(
        ".env",
        ".env.local",
        ".env.development",
        ".env.production",
        ".env.test",
        ".env.staging",
        "credentials",
        "credentials.json",
        "credentials.xml",
        "secrets.json",
        "secrets.yaml",
        "secrets.yml",
        "id_rsa",
        "id_dsa",
        "id_ecdsa",
        "id_ed25519",
        "id_rsa.pub",
        "id_ed25519.pub",
        ".npmrc",
        ".pypirc",
        "netrc",
        ".netrc",
        "auth.json",
        "service-account.json",
        "google-services.json",
    )

    private val SENSITIVE_EXTENSIONS: Set<String> = setOf(
        "pem", "key", "p12", "pfx", "jks", "keystore", "crt", "cer", "der",
    )

    data class Collected(
        val files: List<CommitFileChange>,
        val recentMessages: List<String> = emptyList(),
    ) {
        fun toRequest(style: String = "conventional_en"): GenerateCommitMessageRequest =
            GenerateCommitMessageRequest(
                files = files,
                style = style,
                recentMessages = recentMessages,
            )
    }

    fun collect(project: Project, changes: Collection<Change>): Collected {
        // Scope few-shot history to roots touched by these changes (multi-repo safe).
        val recentMessages = RecentCommitCollector.collect(project, changes)
        if (changes.isEmpty()) {
            return Collected(files = emptyList(), recentMessages = recentMessages)
        }

        val prepared = ArrayList<CommitFileChange>(changes.size)
        for (change in changes) {
            prepared.add(prepareFile(project, change))
        }

        return Collected(
            files = collapseOmittedGroups(prepared),
            recentMessages = recentMessages,
        )
    }

    /**
     * Collapse many lockfile / sensitive entries into a single summary row each so
     * path metadata cannot blow the prompt when dozens of dependency locks change.
     */
    internal fun collapseOmittedGroups(files: List<CommitFileChange>): List<CommitFileChange> {
        if (files.size <= 1) return files
        val lockfiles = files.filter { it.omittedReason == Omitted.LOCKFILE }
        val sensitive = files.filter { it.omittedReason == Omitted.SENSITIVE }
        if (lockfiles.size < 2 && sensitive.size < 2) return files

        val out = ArrayList<CommitFileChange>(files.size)
        var lockSummaryEmitted = false
        var sensitiveSummaryEmitted = false
        for (f in files) {
            when (f.omittedReason) {
                Omitted.LOCKFILE -> {
                    if (lockfiles.size < 2) {
                        out.add(f)
                    } else if (!lockSummaryEmitted) {
                        out.add(
                            CommitFileChange(
                                path = "${lockfiles.size} dependency lock files",
                                changeType = "MODIFIED",
                                omittedReason = Omitted.LOCKFILE,
                            ),
                        )
                        lockSummaryEmitted = true
                    }
                }
                Omitted.SENSITIVE -> {
                    if (sensitive.size < 2) {
                        out.add(f)
                    } else if (!sensitiveSummaryEmitted) {
                        out.add(
                            CommitFileChange(
                                path = "${sensitive.size} sensitive files",
                                changeType = "MODIFIED",
                                omittedReason = Omitted.SENSITIVE,
                            ),
                        )
                        sensitiveSummaryEmitted = true
                    }
                }
                else -> out.add(f)
            }
        }
        return out
    }

    fun changeTypeOf(change: Change): String =
        when (change.type) {
            Change.Type.NEW -> "ADDED"
            Change.Type.DELETED -> "DELETED"
            Change.Type.MOVED -> "MOVED"
            Change.Type.MODIFICATION -> "MODIFIED"
        }

    fun pathOf(change: Change): String {
        val after = change.afterRevision?.file
        val before = change.beforeRevision?.file
        val file = after ?: before
        return file?.path ?: change.toString()
    }

    fun oldPathOf(change: Change): String? {
        if (change.type != Change.Type.MOVED) return null
        val before = change.beforeRevision?.file?.path ?: return null
        val after = change.afterRevision?.file?.path
        return if (before != after) before else null
    }

    /** Project-relative path when [absolutePath] is under [project]; otherwise normalized absolute. */
    fun relativePath(project: Project?, absolutePath: String): String {
        val normalized = absolutePath.replace('\\', '/')
        val base = project?.basePath?.replace('\\', '/')?.trimEnd('/')
        if (!base.isNullOrEmpty()) {
            val prefix = "$base/"
            if (normalized == base) return "."
            if (normalized.startsWith(prefix)) {
                return normalized.substring(prefix.length)
            }
        }
        return normalized
    }

    /** True when [path] basename is a known dependency lock / resolve file. */
    fun isLockFile(path: String): Boolean {
        val name = basename(path)
        return name in LOCK_FILE_NAMES
    }

    /** True when [path] looks like secrets / env / key material. */
    fun isSensitiveFile(path: String): Boolean {
        val name = basename(path)
        val lower = name.lowercase(Locale.ROOT)
        if (lower in SENSITIVE_BASENAME_EXACT || name in SENSITIVE_BASENAME_EXACT) return true
        if (lower.startsWith(".env.") || lower == ".env") return true
        if (lower.endsWith(".env")) return true
        val ext = lower.substringAfterLast('.', missingDelimiterValue = "")
        if (ext in SENSITIVE_EXTENSIONS) return true
        if (lower.contains("secret") && (lower.endsWith(".json") || lower.endsWith(".yml") || lower.endsWith(".yaml") || lower.endsWith(".toml"))) {
            return true
        }
        return false
    }

    /**
     * Line-level change range (0-based, end exclusive), matching IntelliJ [LineFragment] / [Range].
     */
    data class LineChange(
        val start1: Int,
        val end1: Int,
        val start2: Int,
        val end2: Int,
    )

    data class Hunk(
        /** 1-based old start line (unified diff). */
        val oldStart: Int,
        val oldCount: Int,
        /** 1-based new start line (unified diff). */
        val newStart: Int,
        val newCount: Int,
        /** Body lines including leading ' ', '-', or '+'. */
        val lines: List<String>,
    ) {
        fun render(): String {
            val sb = StringBuilder()
            sb.append("@@ -").append(oldStart)
            if (oldCount != 1) sb.append(',').append(oldCount)
            sb.append(" +").append(newStart)
            if (newCount != 1) sb.append(',').append(newCount)
            sb.append(" @@\n")
            for (line in lines) {
                sb.append(line).append('\n')
            }
            return sb.toString()
        }
    }

    /**
     * Build unified hunks with [context] lines around each change.
     * Unchanged lines outside context are omitted.
     */
    internal fun buildHunks(
        beforeLines: List<String>,
        afterLines: List<String>,
        changes: List<LineChange>,
        context: Int = HUNK_CONTEXT_LINES,
    ): List<Hunk> {
        if (changes.isEmpty()) return emptyList()
        val groups = groupChanges(changes, context)
        return groups.mapNotNull { group ->
            buildOneHunk(beforeLines, afterLines, group, context)
        }
    }

    /** Group changes whose gaps are within 2*[context] lines (standard unified-diff merge). */
    internal fun groupChanges(changes: List<LineChange>, context: Int): List<List<LineChange>> {
        val sorted = changes.sortedWith(compareBy({ it.start1 }, { it.start2 }))
        if (sorted.isEmpty()) return emptyList()
        val groups = ArrayList<ArrayList<LineChange>>()
        var current = ArrayList<LineChange>()
        current.add(sorted[0])
        for (i in 1 until sorted.size) {
            val prev = current.last()
            val c = sorted[i]
            val gap = c.start1 - prev.end1
            if (gap <= context * 2) {
                current.add(c)
            } else {
                groups.add(current)
                current = ArrayList()
                current.add(c)
            }
        }
        groups.add(current)
        return groups
    }

    private fun buildOneHunk(
        beforeLines: List<String>,
        afterLines: List<String>,
        group: List<LineChange>,
        context: Int,
    ): Hunk? {
        val first = group.first()
        val last = group.last()
        val hunkStart1 = (first.start1 - context).coerceAtLeast(0)
        val hunkEnd1 = (last.end1 + context).coerceAtMost(beforeLines.size)
        val leading = first.start1 - hunkStart1
        val hunkStart2 = (first.start2 - leading).coerceAtLeast(0)
        val trailing = hunkEnd1 - last.end1
        val hunkEnd2 = (last.end2 + trailing).coerceAtMost(afterLines.size)

        val lines = ArrayList<String>()
        var i1 = hunkStart1
        var i2 = hunkStart2
        for (c in group) {
            while (i1 < c.start1 && i2 < c.start2 && i1 < beforeLines.size && i2 < afterLines.size) {
                lines.add(" " + beforeLines[i1])
                i1++
                i2++
            }
            while (i1 < c.end1 && i1 < beforeLines.size) {
                lines.add("-" + beforeLines[i1])
                i1++
            }
            while (i2 < c.end2 && i2 < afterLines.size) {
                lines.add("+" + afterLines[i2])
                i2++
            }
        }
        while (i1 < hunkEnd1 && i2 < hunkEnd2 && i1 < beforeLines.size && i2 < afterLines.size) {
            lines.add(" " + beforeLines[i1])
            i1++
            i2++
        }
        if (lines.isEmpty()) return null

        val oldCount = lines.count { it.startsWith("-") || it.startsWith(" ") }
        val newCount = lines.count { it.startsWith("+") || it.startsWith(" ") }
        val oldStart = if (oldCount == 0) 0 else hunkStart1 + 1
        val newStart = if (newCount == 0) 0 else hunkStart2 + 1
        return Hunk(
            oldStart = oldStart,
            oldCount = oldCount,
            newStart = newStart,
            newCount = newCount,
            lines = lines,
        )
    }

    /**
     * Compare line lists into change ranges. Prefer [ComparisonManager] when an Application
     * is available; fall back to [ByLineRt] (same engine, no service lookup) for tests.
     */
    internal fun compareLineChanges(beforeLines: List<String>, afterLines: List<String>): List<LineChange> {
        if (beforeLines.isEmpty() && afterLines.isEmpty()) return emptyList()
        if (beforeLines.isEmpty()) {
            return listOf(LineChange(0, 0, 0, afterLines.size))
        }
        if (afterLines.isEmpty()) {
            return listOf(LineChange(0, beforeLines.size, 0, 0))
        }

        val app = ApplicationManager.getApplication()
        if (app != null) {
            val before = joinLines(beforeLines)
            val after = joinLines(afterLines)
            val fragments = ComparisonManager.getInstance().compareLines(
                before,
                after,
                ComparisonPolicy.DEFAULT,
                EmptyProgressIndicator(),
            )
            return fragments.map {
                LineChange(it.startLine1, it.endLine1, it.startLine2, it.endLine2)
            }
        }

        val iterable = ByLineRt.compare(
            beforeLines,
            afterLines,
            ComparisonPolicy.DEFAULT,
            CancellationChecker.EMPTY,
        )
        return iterable.iterateChanges().map {
            LineChange(it.start1, it.end1, it.start2, it.end2)
        }
    }

    internal fun splitLines(text: String): List<String> {
        if (text.isEmpty()) return emptyList()
        // Preserve trailing empty line when content ends with '\n'
        return text.split('\n')
    }

    internal fun buildUnifiedDiff(
        path: String,
        oldPath: String?,
        before: String?,
        after: String?,
        context: Int = HUNK_CONTEXT_LINES,
    ): BuiltDiff {
        if (before == null && after == null) {
            return BuiltDiff(
                text = "--- a/$path\n+++ b/$path\n(unavailable content)\n",
                additions = 0,
                deletions = 0,
                hunks = emptyList(),
                omittedReason = Omitted.UNAVAILABLE,
            )
        }
        if ((before != null && isBinary(before)) || (after != null && isBinary(after))) {
            return BuiltDiff(
                text = "--- a/$path\n+++ b/$path\n(binary file omitted)\n",
                additions = 0,
                deletions = 0,
                hunks = emptyList(),
                omittedReason = Omitted.BINARY,
            )
        }

        val beforeLines = splitLines(before ?: "")
        val afterLines = splitLines(after ?: "")
        // Drop a single trailing empty entry caused by final newline so line counts match editors.
        val bLines = dropTrailingEmpty(beforeLines, before)
        val aLines = dropTrailingEmpty(afterLines, after)

        val changes = compareLineChanges(bLines, aLines)
        var additions = 0
        var deletions = 0
        for (c in changes) {
            deletions += (c.end1 - c.start1)
            additions += (c.end2 - c.start2)
        }

        val header = buildString {
            val left = oldPath ?: path
            if (before == null) {
                append("--- /dev/null\n")
            } else {
                append("--- a/").append(left).append('\n')
            }
            if (after == null) {
                append("+++ /dev/null\n")
            } else {
                append("+++ b/").append(path).append('\n')
            }
        }

        if (changes.isEmpty()) {
            return BuiltDiff(
                text = header,
                additions = 0,
                deletions = 0,
                hunks = emptyList(),
                omittedReason = Omitted.EMPTY,
            )
        }

        val hunks = buildHunks(bLines, aLines, changes, context)
        val body = hunks.joinToString("") { it.render() }
        return BuiltDiff(
            text = header + body,
            additions = additions,
            deletions = deletions,
            hunks = hunks,
            header = header,
            omittedReason = null,
        )
    }

    internal object Omitted {
        const val LOCKFILE = "lockfile"
        const val SENSITIVE = "sensitive"
        const val BINARY = "binary"
        const val UNAVAILABLE = "unavailable"
        const val READ_ERROR = "read_error"
        const val EMPTY = "empty"
    }

    // --- private ---

    internal data class BuiltDiff(
        val text: String,
        val additions: Int,
        val deletions: Int,
        val hunks: List<Hunk>,
        val header: String = "",
        val omittedReason: String?,
    )

    private fun prepareFile(project: Project, change: Change): CommitFileChange {
        val absPath = pathOf(change)
        val absOld = oldPathOf(change)
        val path = relativePath(project, absPath)
        val oldPath = absOld?.let { relativePath(project, it) }
        val changeType = changeTypeOf(change)

        if (isLockFile(path) || isLockFile(absPath)) {
            return CommitFileChange(
                path = path,
                oldPath = oldPath,
                changeType = changeType,
                omittedReason = Omitted.LOCKFILE,
            )
        }
        if (isSensitiveFile(path) || isSensitiveFile(absPath)) {
            return CommitFileChange(
                path = path,
                oldPath = oldPath,
                changeType = changeType,
                omittedReason = Omitted.SENSITIVE,
            )
        }

        val before = safeContent(change.beforeRevision)
        val after = safeContent(change.afterRevision)
        if (before == null && after == null &&
            change.beforeRevision == null && change.afterRevision == null
        ) {
            return CommitFileChange(
                path = path,
                oldPath = oldPath,
                changeType = changeType,
                omittedReason = Omitted.UNAVAILABLE,
            )
        }
        if (before == null && after == null) {
            val hasRevision = change.beforeRevision != null || change.afterRevision != null
            return CommitFileChange(
                path = path,
                oldPath = oldPath,
                changeType = changeType,
                omittedReason = if (hasRevision) Omitted.READ_ERROR else Omitted.UNAVAILABLE,
            )
        }

        return try {
            val built = buildUnifiedDiff(path, oldPath, before, after)
            if (built.omittedReason == Omitted.BINARY ||
                built.omittedReason == Omitted.UNAVAILABLE ||
                built.omittedReason == Omitted.EMPTY
            ) {
                CommitFileChange(
                    path = path,
                    oldPath = oldPath,
                    changeType = changeType,
                    additions = built.additions,
                    deletions = built.deletions,
                    omittedReason = built.omittedReason,
                )
            } else {
                CommitFileChange(
                    path = path,
                    oldPath = oldPath,
                    changeType = changeType,
                    additions = built.additions,
                    deletions = built.deletions,
                    hunks = built.hunks.map { it.render() },
                )
            }
        } catch (e: ProcessCanceledException) {
            throw e
        } catch (e: Exception) {
            log.debug("diff failed for $path", e)
            CommitFileChange(
                path = path,
                oldPath = oldPath,
                changeType = changeType,
                omittedReason = Omitted.READ_ERROR,
            )
        }
    }

    private fun dropTrailingEmpty(lines: List<String>, original: String?): List<String> {
        if (original == null) return lines
        if (original.isEmpty()) return emptyList()
        // "a\nb\n".split -> ["a","b",""] — drop final empty from trailing newline
        if (original.endsWith('\n') && lines.isNotEmpty() && lines.last().isEmpty()) {
            return lines.dropLast(1)
        }
        return lines
    }

    private fun joinLines(lines: List<String>): String =
        if (lines.isEmpty()) "" else lines.joinToString("\n") + "\n"

    private fun basename(path: String): String =
        path.substringAfterLast('/').substringAfterLast('\\')

    private fun safeContent(revision: ContentRevision?): String? {
        if (revision == null) return null
        return try {
            revision.content
        } catch (e: ProcessCanceledException) {
            throw e
        } catch (e: VcsException) {
            log.debug("content revision failed", e)
            null
        } catch (e: Exception) {
            log.debug("content revision failed", e)
            null
        }
    }

    private fun isBinary(content: String): Boolean = content.indexOf('\u0000') >= 0
}
