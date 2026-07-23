package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

/**
 * Per-file change for commit message generation.
 *
 * [path] is project-relative. [oldPath] is set for renames/moves.
 * [diff] is unified-hunk text, or null when omitted ([omittedReason]).
 */
@Serializable
data class CommitFileChange(
    val path: String,
    /** ADDED | MODIFIED | DELETED | MOVED */
    val changeType: String,
    val oldPath: String? = null,
    val additions: Int = 0,
    val deletions: Int = 0,
    val diff: String? = null,
    val truncated: Boolean = false,
    /**
     * lockfile | sensitive | binary | unavailable | budget | read_error | empty
     */
    val omittedReason: String? = null,
)
