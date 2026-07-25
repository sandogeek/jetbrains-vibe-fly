package com.github.sandogeek.jetbrainsvibefly.agent

import java.nio.file.Files
import java.nio.file.Path

/** Shared resolution for Bun binary and vibefly-agent entry. */
object VibeflyAgentPaths {

    fun resolveBunCommand(): String {
        System.getProperty("vibefly.bun")?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        System.getenv("VIBEFLY_BUN")?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        return "bun"
    }

    fun resolveAgentEntry(): Path {
        val explicit = System.getProperty("vibefly.agent.entry")?.trim().orEmpty()
            .ifEmpty { System.getenv("VIBEFLY_AGENT_ENTRY")?.trim().orEmpty() }
        if (explicit.isNotEmpty()) {
            val p = Path.of(explicit)
            check(Files.isRegularFile(p)) { "vibefly.agent.entry not found: $p" }
            return p.toAbsolutePath().normalize()
        }
        val relativeCandidates = listOf(
            Path.of("packages/vibefly-agent/src/main.ts"),
            Path.of("packages/vibefly-agent/dist/main.js"),
        )
        val searchRoots = linkedSetOf<Path>()
        System.getProperty("user.dir")?.let {
            searchRoots.add(Path.of(it).toAbsolutePath().normalize())
        }
        System.getenv("VIBEFLY_REPO_ROOT")?.trim()?.takeIf { it.isNotEmpty() }?.let {
            searchRoots.add(Path.of(it).toAbsolutePath().normalize())
        }
        for (root in searchRoots) {
            var dir: Path? = root
            for (i in 0 until 12) {
                if (dir == null) break
                for (rel in relativeCandidates) {
                    val candidate = dir.resolve(rel)
                    if (Files.isRegularFile(candidate)) {
                        return candidate.normalize()
                    }
                }
                dir = dir.parent
            }
        }
        error(
            "vibefly-agent entry not found " +
                "(set -Dvibefly.agent.entry=... / VIBEFLY_AGENT_ENTRY, " +
                "or run :plugin:runIde from monorepo which injects the path)",
        )
    }
}
