package com.github.sandogeek.jetbrainsvibefly.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path

/**
 * Pure unit tests for Bun binary resolution used when spawning the packaged agent.
 * Host PATH / Homebrew must not leak into fixtures — pass explicit knownLocations.
 */
class VibeflyAgentPathsTest {

    @Test
    fun resolveBunExecutablePrefersKnownLocationOverPath() {
        val tmp = Files.createTempDirectory("vibefly-bun-known")
        try {
            val known = tmp.resolve("known-bun")
            val onPath = tmp.resolve("path-bun")
            Files.writeString(known, "#!/bin/sh\necho known\n")
            Files.writeString(onPath, "#!/bin/sh\necho path\n")
            known.toFile().setExecutable(true)
            onPath.toFile().setExecutable(true)
            // PATH entry must be named "bun"
            val pathDir = tmp.resolve("bin")
            Files.createDirectories(pathDir)
            val pathBun = pathDir.resolve("bun")
            Files.copy(onPath, pathBun)
            pathBun.toFile().setExecutable(true)

            val found = VibeflyAgentPaths.resolveBunExecutable(
                pathEnv = pathDir.toString(),
                knownLocations = listOf(known),
            )
            assertEquals(known.toAbsolutePath().normalize().toString(), found)
        } finally {
            tmp.toFile().deleteRecursively()
        }
    }

    @Test
    fun resolveBunExecutableFallsBackToPath() {
        val tmp = Files.createTempDirectory("vibefly-bun-path")
        try {
            val pathDir = tmp.resolve("bin")
            Files.createDirectories(pathDir)
            val fake = pathDir.resolve("bun")
            Files.writeString(fake, "#!/bin/sh\necho fake\n")
            fake.toFile().setExecutable(true)

            val found = VibeflyAgentPaths.resolveBunExecutable(
                pathEnv = pathDir.toString(),
                knownLocations = listOf(tmp.resolve("missing-bun")),
            )
            assertEquals(fake.toAbsolutePath().normalize().toString(), found)
        } finally {
            tmp.toFile().deleteRecursively()
        }
    }

    @Test
    fun resolveBunExecutableReturnsNullWhenMissingEverywhere() {
        val tmp = Files.createTempDirectory("vibefly-bun-missing")
        try {
            val found = VibeflyAgentPaths.resolveBunExecutable(
                pathEnv = tmp.toString(),
                knownLocations = listOf(tmp.resolve("nope")),
            )
            assertNull(found)
        } finally {
            tmp.toFile().deleteRecursively()
        }
    }

    @Test
    fun candidateBunPathsIncludesHomeInstallAndHomebrew() {
        val paths = VibeflyAgentPaths.candidateBunPaths(
            home = "/Users/demo",
            bunInstall = "/opt/bun-install",
        ).map { it.toString().replace('\\', '/') }
        assertTrue(paths.contains("/opt/bun-install/bin/bun") || paths.contains("/opt/bun-install/bin/bun.exe"))
        assertTrue(paths.any { it.contains("/Users/demo/.bun/bin/") })
        assertTrue(paths.any { it.contains("/opt/homebrew/bin/") || it.contains("/usr/local/bin/") })
    }

    @Test
    fun liveResolveBunExecutableFindsHostBunWhenPresent() {
        val found = VibeflyAgentPaths.resolveBunExecutable(pathEnv = "")
        if (Files.isExecutable(Path.of("/opt/homebrew/bin/bun")) ||
            Files.isExecutable(Path.of("/usr/local/bin/bun")) ||
            Files.isExecutable(Path.of(System.getProperty("user.home"), ".bun", "bin", "bun"))
        ) {
            assertNotNull(found)
            assertTrue(Files.isExecutable(Path.of(found!!)))
        }
    }

    @Test
    fun resolveAgentWorkingDirectoryForBundledLayout() {
        val entry = Path.of("/plugins/plugin/agent/dist/main.js")
        val cwd = VibeflyAgentPaths.resolveAgentWorkingDirectory(entry)
        assertEquals(Path.of("/plugins/plugin/agent").toAbsolutePath().normalize(), cwd)
    }
}
