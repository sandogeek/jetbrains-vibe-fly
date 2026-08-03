package com.github.sandogeek.jetbrainsvibefly.agent

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.util.SystemInfo
import java.nio.file.Files
import java.nio.file.Path

/** Shared resolution for Node.js binary and vibefly-agent entry. */
object VibeflyAgentPaths {

    private const val PLUGIN_ID = "com.github.sandogeek.jetbrainsvibefly"

    /**
     * Absolute path to the Node.js binary.
     *
     * Prefer:
     * 1. Explicit `-Dvibefly.node` / `VIBEFLY_NODE`
     * 2. Common Node.js install locations — IDE process PATH often
     *    lacks these after install-from-disk / marketplace packaging
     * 3. `PATH` lookup (`node` / `node.exe`)
     */
    fun resolveNodeCommand(): String {
        val explicit = System.getProperty("vibefly.node")?.trim().orEmpty()
            .ifEmpty { System.getenv("VIBEFLY_NODE")?.trim().orEmpty() }
        if (explicit.isNotEmpty()) {
            return requireExecutable(expandHome(Path.of(explicit)), source = "vibefly.node / VIBEFLY_NODE")
        }
        return resolveNodeExecutable()
            ?: error(
                "Cannot find 'node'. Install Node.js or set -Dvibefly.node=/path/to/node " +
                    "(or VIBEFLY_NODE). The IDE process PATH often omits common Node.js install locations, " +
                    "so a packaged plugin cannot spawn the agent with a bare 'node'.",
            )
    }

    /**
     * Prefer:
     * 1. Explicit `-Dvibefly.agent.entry` / `VIBEFLY_AGENT_ENTRY`
     * 2. Plugin-bundled `agent/dist/main.js` (installable zip / sandbox)
     * 3. Monorepo `packages/vibefly-agent/{dist/main.js,src/main.ts}` for local development
     */
    fun resolveAgentEntry(): Path {
        val explicit = System.getProperty("vibefly.agent.entry")?.trim().orEmpty()
            .ifEmpty { System.getenv("VIBEFLY_AGENT_ENTRY")?.trim().orEmpty() }
        if (explicit.isNotEmpty()) {
            val p = Path.of(explicit)
            check(Files.isRegularFile(p)) { "vibefly.agent.entry not found: $p" }
            return p.toAbsolutePath().normalize()
        }

        resolveBundledAgentEntry()?.let { return it }

        val relativeCandidates = listOf(
            Path.of("packages/vibefly-agent/dist/main.js"),
            Path.of("packages/vibefly-agent/src/main.ts"),
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
                "or install a build that bundles agent/, " +
                "or run :plugin:runIde from monorepo which injects the path)",
        )
    }

    /**
     * Working directory for the Node.js process (needs package.json + node_modules for resolution).
     * - bundled: `…/agent`
     * - monorepo src: `…/packages/vibefly-agent` (parent of `src`)
     * - monorepo dist: `…/packages/vibefly-agent` (parent of `dist`)
     */
    fun resolveAgentWorkingDirectory(entry: Path = resolveAgentEntry()): Path {
        val parent = entry.parent
            ?: error("vibefly-agent entry has no parent: $entry")
        val name = parent.fileName?.toString().orEmpty()
        return when (name) {
            "dist", "src" -> parent.parent ?: parent
            else -> parent
        }.toAbsolutePath().normalize()
    }

    private fun resolveBundledAgentEntry(): Path? {
        val plugin = PluginManagerCore.getPlugin(PluginId.getId(PLUGIN_ID)) ?: return null
        val pluginPath = plugin.pluginPath ?: return null
        val candidates = listOf(
            pluginPath.resolve("agent/dist/main.js"),
            // Some layouts expand the zip with an extra nesting; also try plugin root siblings.
            pluginPath.resolve("dist/main.js"),
        )
        for (candidate in candidates) {
            if (Files.isRegularFile(candidate)) {
                return candidate.toAbsolutePath().normalize()
            }
        }
        return null
    }

    /**
     * Resolve an absolute Node.js executable without requiring it to be on PATH.
     * Returns null when nothing usable is found.
     *
     * [knownLocations] defaults to [candidateNodePaths]; tests pass an explicit list
     * so host Homebrew installs do not leak into unit fixtures.
     */
    internal fun resolveNodeExecutable(
        pathEnv: String? = System.getenv("PATH"),
        knownLocations: List<Path> = candidateNodePaths(),
    ): String? {
        for (candidate in knownLocations) {
            if (isExecutable(candidate)) {
                return candidate.toAbsolutePath().normalize().toString()
            }
        }
        return findOnPath(pathEnv)
    }

    internal fun candidateNodePaths(
        home: String = System.getProperty("user.home").orEmpty(),
    ): List<Path> {
        return buildList {
            if (home.isNotEmpty()) {
                add(Path.of(home, ".nvm", "current", "bin", nodeBinaryName()))
            }
            // macOS Homebrew (Apple Silicon + Intel)
            add(Path.of("/opt/homebrew/bin", nodeBinaryName()))
            add(Path.of("/usr/local/bin", nodeBinaryName()))
            add(Path.of("/usr/bin", nodeBinaryName()))
        }
    }

    private fun findOnPath(pathEnv: String?): String? {
        if (pathEnv.isNullOrEmpty()) return null
        val name = nodeBinaryName()
        val separator = System.getProperty("path.separator") ?: ":"
        for (dir in pathEnv.split(separator)) {
            if (dir.isEmpty()) continue
            val candidate = Path.of(dir, name)
            if (isExecutable(candidate)) {
                return candidate.toAbsolutePath().normalize().toString()
            }
        }
        return null
    }

    private fun nodeBinaryName(): String =
        if (SystemInfo.isWindows) "node.exe" else "node"

    private fun expandHome(path: Path): Path {
        val raw = path.toString()
        if (raw == "~") {
            return Path.of(System.getProperty("user.home"))
        }
        if (raw.startsWith("~/") || raw.startsWith("~\\")) {
            return Path.of(System.getProperty("user.home"), raw.substring(2))
        }
        return path
    }

    private fun requireExecutable(path: Path, source: String): String {
        check(isExecutable(path)) { "$source is not an executable file: $path" }
        return path.toAbsolutePath().normalize().toString()
    }

    private fun isExecutable(path: Path): Boolean {
        return try {
            Files.isRegularFile(path) && Files.isExecutable(path)
        } catch (_: Exception) {
            false
        }
    }
}
