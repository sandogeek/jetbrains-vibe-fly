package com.github.sandogeek.jetbrainsvibefly.commit

import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.vcs.FilePath
import com.intellij.openapi.vcs.ProjectLevelVcsManager
import com.intellij.openapi.vcs.VcsException
import com.intellij.openapi.vcs.VcsRoot
import com.intellij.openapi.vcs.changes.Change
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.vcs.log.VcsCommitMetadata
import com.intellij.vcs.log.VcsLogProvider

/**
 * Collects recent commit messages via the platform [VcsLogProvider] API
 * (same IDE VCS stack as Change content / log UI — no raw `git log` process).
 *
 * Multi-root: only roots touched by [changes] are queried; candidates are merged
 * by [VcsCommitMetadata.getCommitTime] (newest first), then de-duplicated.
 */
object RecentCommitCollector {

    const val DEFAULT_LIMIT: Int = 10
    /** Soft cap per message so a long body cannot dominate the prompt. */
    const val MAX_MESSAGE_CHARS: Int = 400

    private val log = logger<RecentCommitCollector>()

    data class Candidate(
        val message: String,
        val commitTime: Long,
    )

    fun collect(
        project: Project,
        changes: Collection<Change> = emptyList(),
        limit: Int = DEFAULT_LIMIT,
    ): List<String> {
        val n = limit.coerceIn(1, 50)
        val vcsManager = ProjectLevelVcsManager.getInstance(project)
        if (!vcsManager.hasActiveVcss()) return emptyList()

        // logProvider EP is project-scoped (area=IDEA_PROJECT); Application lookup throws.
        val providers = try {
            VcsLogProvider.LOG_PROVIDER_EP.getExtensionList(project)
        } catch (e: IllegalArgumentException) {
            log.error("VcsLogProvider EP unavailable", e)
            return emptyList()
        }
        if (providers.isEmpty()) return emptyList()

        val roots = resolveRoots(project, changes, vcsManager)
        if (roots.isEmpty()) return emptyList()

        // Per-root budget equals global limit so a quieter root can still surface
        // newer commits after the global sort; total work is O(roots * limit).
        val candidates = ArrayList<Candidate>(roots.size * n)
        for (root in roots) {
            candidates.addAll(collectCandidatesFromRoot(root, providers, n))
        }
        return rankCandidates(candidates, n)
    }

    /**
     * Prefer VCS roots that own the current changes. Fall back to all mapped roots
     * when no change path resolves (empty selection / unavailable revisions).
     */
    internal fun resolveRoots(
        project: Project,
        changes: Collection<Change>,
        vcsManager: ProjectLevelVcsManager = ProjectLevelVcsManager.getInstance(project),
    ): List<VcsRoot> {
        if (changes.isNotEmpty()) {
            val byPath = LinkedHashMap<String, VcsRoot>()
            for (change in changes) {
                for (filePath in filePathsOf(change)) {
                    val root = vcsManager.getVcsRootObjectFor(filePath) ?: continue
                    val key = root.path.path
                    byPath.putIfAbsent(key, root)
                }
                val vf = change.virtualFile
                if (vf != null) {
                    val root = vcsManager.getVcsRootObjectFor(vf) ?: continue
                    val key = root.path.path
                    byPath.putIfAbsent(key, root)
                }
            }
            if (byPath.isNotEmpty()) return byPath.values.toList()
        }

        val all = vcsManager.getAllVcsRoots()
        if (all.isEmpty()) return emptyList()
        val byPath = LinkedHashMap<String, VcsRoot>()
        for (root in all) {
            val key = root.path.path
            byPath.putIfAbsent(key, root)
        }
        return byPath.values.toList()
    }

    private fun filePathsOf(change: Change): Sequence<FilePath> = sequence {
        change.afterRevision?.file?.let { yield(it) }
        change.beforeRevision?.file?.let { yield(it) }
    }

    /**
     * Read up to [limit] newest commits from a single VCS root as timed candidates.
     */
    internal fun collectCandidatesFromRoot(
        root: VcsRoot,
        providers: List<VcsLogProvider>,
        limit: Int,
    ): List<Candidate> {
        if (limit <= 0) return emptyList()
        val vcs = root.vcs ?: return emptyList()
        val path: VirtualFile = root.path
        val provider = providers.firstOrNull { it.supportedVcs == vcs.keyInstanceMethod }
            ?: return emptyList()

        return try {
            val data = provider.readFirstBlock(
                path,
            ) { limit }
            toCandidates(data.commits, limit)
        } catch (e: VcsException) {
            log.debug("VcsLogProvider.readFirstBlock failed for ${path.path}", e)
            emptyList()
        } catch (e: Exception) {
            log.debug("VcsLogProvider.readFirstBlock failed for ${path.path}", e)
            emptyList()
        }
    }

    internal fun toCandidates(
        commits: List<VcsCommitMetadata>,
        limit: Int,
    ): List<Candidate> {
        val out = ArrayList<Candidate>(minOf(limit, commits.size))
        for (commit in commits) {
            val msg = normalizeMessage(commit.fullMessage) ?: continue
            out.add(Candidate(message = msg, commitTime = commit.commitTime))
            if (out.size >= limit) break
        }
        return out
    }

    /**
     * Newest [commitTime] first; first occurrence of a message wins (keeps newest).
     */
    internal fun rankCandidates(candidates: List<Candidate>, limit: Int): List<String> {
        if (candidates.isEmpty() || limit <= 0) return emptyList()
        val sorted = candidates.sortedWith(
            compareByDescending<Candidate> { it.commitTime }
                .thenBy { it.message },
        )
        val seen = HashSet<String>()
        val out = ArrayList<String>(minOf(limit, sorted.size))
        for (c in sorted) {
            if (!seen.add(c.message)) continue
            out.add(c.message)
            if (out.size >= limit) break
        }
        return out
    }

    internal fun normalizeMessage(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        var text = raw.replace("\r\n", "\n").replace('\r', '\n').trim()
        if (text.isEmpty()) return null
        // Skip pure merge subjects — low signal for style few-shot.
        if (text.startsWith("Merge ", ignoreCase = true) && !text.contains('\n')) {
            return null
        }
        if (text.length > MAX_MESSAGE_CHARS) {
            text = text.take(MAX_MESSAGE_CHARS).trimEnd()
            if (!text.endsWith("...")) text = "$text..."
        }
        return text
    }
}
