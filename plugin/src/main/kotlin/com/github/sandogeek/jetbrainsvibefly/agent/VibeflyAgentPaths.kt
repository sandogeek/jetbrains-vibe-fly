package com.github.sandogeek.jetbrainsvibefly.agent

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.util.SystemInfo
import java.nio.file.Files
import java.nio.file.Path

/** Shared resolution for Bun binary and vibefly-agent entry. */
object VibeflyAgentPaths {

    private const val PLUGIN_ID = "com.github.sandogeek.jetbrainsvibefly"

    /**
     * Absolute path to the Bun binary.
     *
     * Prefer:
     * 1. Explicit `-Dvibefly.bun` / `VIBEFLY_BUN`
     * 2. Common install locations (`~/.bun`, Homebrew) — IDE process PATH often
     *    lacks these after install-from-disk / marketplace packaging
     * 3. `PATH` lookup (`bun` / `bun.exe`)
     */
    fun resolveBunCommand(): String {
        val explicit = System.getProperty("vibefly.bun")?.trim().orEmpty()
            .ifEmpty { System.getenv("VIBEFLY_BUN")?.trim().orEmpty() }
        if (explicit.isNotEmpty()) {
            return requireExecutable(expandHome(Path.of(explicit)), source = "vibefly.bun / VIBEFLY_BUN")
        }
        return resolveBunExecutable()
            ?: error(
                "Cannot find 'bun'. Install Bun (https://bun.sh) or set -Dvibefly.bun=/path/to/bun " +
                    "(or VIBEFLY_BUN). The IDE process PATH often omits Homebrew (/opt/homebrew/bin) " +
                    "and ~/.bun/bin, so a packaged plugin cannot spawn the agent with a bare 'bun'.",
            )
    }

    /**
     * Prefer:
     * 1. Explicit `-Dvibefly.agent.entry` / `VIBEFLY_AGENT_ENTRY`
     * 2. Plugin-bundled `agent/dist/main.js` (installable zip / sandbox)
     * 3. Monorepo `packages/vibefly-agent/{src/main.ts,dist/main.js}` for local development
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
                "or install a build that bundles agent/, " +
                "or run :plugin:runIde from monorepo which injects the path)",
        )
    }

    /**
     * Working directory for the Bun process (needs package.json + node_modules for resolution).
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
     * Resolve an absolute Bun executable without requiring it to be on PATH.
     * Returns null when nothing usable is found.
     *
     * [knownLocations] defaults to [candidateBunPaths]; tests pass an explicit list
     * so host Homebrew installs do not leak into unit fixtures.
     */
    internal fun resolveBunExecutable(
        pathEnv: String? = System.getenv("PATH"),
        knownLocations: List<Path> = candidateBunPaths(),
    ): String? {
        for (candidate in knownLocations) {
            if (isExecutable(candidate)) {
                return candidate.toAbsolutePath().normalize().toString()
            }
        }
        return findOnPath(pathEnv)
    }

    internal fun candidateBunPaths(
        home: String = System.getProperty("user.home").orEmpty(),
        bunInstall: String? = System.getenv("BUN_INSTALL"),
    ): List<Path> {
        val install = bunInstall?.trim().orEmpty()
        return buildList {
            if (install.isNotEmpty()) {
                add(Path.of(install, "bin", bunBinaryName()))
            }
            if (home.isNotEmpty()) {
                add(Path.of(home, ".bun", "bin", bunBinaryName()))
            }
            // macOS Homebrew (Apple Silicon + Intel)
            add(Path.of("/opt/homebrew/bin", bunBinaryName()))
            add(Path.of("/usr/local/bin", bunBinaryName()))
            // Linuxbrew
            add(Path.of("/home/linuxbrew/.linuxbrew/bin", bunBinaryName()))
            // Common Linux package layouts
            add(Path.of("/usr/bin", bunBinaryName()))
        }
    }

    private fun findOnPath(pathEnv: String?): String? {
        if (pathEnv.isNullOrEmpty()) return null
        val name = bunBinaryName()
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

    private fun bunBinaryName(): String =
        if (SystemInfo.isWindows) "bun.exe" else "bun"

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
