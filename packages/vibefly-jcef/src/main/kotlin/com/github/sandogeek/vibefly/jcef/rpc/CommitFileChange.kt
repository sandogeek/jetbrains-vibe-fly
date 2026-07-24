package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

/**
 * Per-file change for commit message generation.
 *
 * [path] is project-relative. [oldPath] is set for renames/moves.
 * [hunks] are full unified-diff hunks (`@@ … @@` + body). Host does not truncate;
 * the agent budgets inclusion against the model context window.
 */
@Serializable
data class CommitFileChange(
    val path: String,
    /** ADDED | MODIFIED | DELETED | MOVED */
    val changeType: String,
    val oldPath: String? = null,
    val additions: Int = 0,
    val deletions: Int = 0,
    /** Unified-diff hunks; empty when omitted ([omittedReason]) or no line changes. */
    val hunks: List<String> = emptyList(),
    /**
     * lockfile | sensitive | binary | unavailable | read_error | empty
     */
    val omittedReason: String? = null,
)
