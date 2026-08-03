package com.github.sandogeek.jetbrainsvibefly.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path

/**
 * Pure unit tests for Node.js binary resolution used when spawning the packaged agent.
 * Host PATH / Homebrew must not leak into fixtures — pass explicit knownLocations.
 */
class VibeflyAgentPathsTest {

    @Test
    fun resolveNodeExecutablePrefersKnownLocationOverPath() {
        val tmp = Files.createTempDirectory("vibefly-node-known")
        try {
            val known = tmp.resolve("known-node")
            val onPath = tmp.resolve("path-node")
            Files.writeString(known, "#!/bin/sh\necho known\n")
            Files.writeString(onPath, "#!/bin/sh\necho path\n")
            known.toFile().setExecutable(true)
            onPath.toFile().setExecutable(true)
            // PATH entry must be named "node"
            val pathDir = tmp.resolve("bin")
            Files.createDirectories(pathDir)
            val pathNode = pathDir.resolve("node")
            Files.copy(onPath, pathNode)
            pathNode.toFile().setExecutable(true)

            val found = VibeflyAgentPaths.resolveNodeExecutable(
                pathEnv = pathDir.toString(),
                knownLocations = listOf(known),
            )
            assertEquals(known.toAbsolutePath().normalize().toString(), found)
        } finally {
            tmp.toFile().deleteRecursively()
        }
    }

    @Test
    fun resolveNodeExecutableFallsBackToPath() {
        val tmp = Files.createTempDirectory("vibefly-node-path")
        try {
            val pathDir = tmp.resolve("bin")
            Files.createDirectories(pathDir)
            val fake = pathDir.resolve("node")
            Files.writeString(fake, "#!/bin/sh\necho fake\n")
            fake.toFile().setExecutable(true)

            val found = VibeflyAgentPaths.resolveNodeExecutable(
                pathEnv = pathDir.toString(),
                knownLocations = listOf(tmp.resolve("missing-node")),
            )
            assertEquals(fake.toAbsolutePath().normalize().toString(), found)
        } finally {
            tmp.toFile().deleteRecursively()
        }
    }

    @Test
    fun resolveNodeExecutableReturnsNullWhenMissingEverywhere() {
        val tmp = Files.createTempDirectory("vibefly-node-missing")
        try {
            val found = VibeflyAgentPaths.resolveNodeExecutable(
                pathEnv = tmp.toString(),
                knownLocations = listOf(tmp.resolve("nope")),
            )
            assertNull(found)
        } finally {
            tmp.toFile().deleteRecursively()
        }
    }

    @Test
    fun candidateNodePathsIncludesNvmAndHomebrew() {
        val paths = VibeflyAgentPaths.candidateNodePaths(
            home = "/Users/demo",
        ).map { it.toString().replace('\\', '/') }
        assertTrue(paths.any { it.contains("/Users/demo/.nvm/current/bin/node") })
        assertTrue(paths.any { it.contains("/opt/homebrew/bin/") || it.contains("/usr/local/bin/") })
    }

    @Test
    fun liveResolveNodeExecutableFindsHostNodeWhenPresent() {
        val found = VibeflyAgentPaths.resolveNodeExecutable(pathEnv = "")
        if (Files.isExecutable(Path.of("/opt/homebrew/bin/node")) ||
            Files.isExecutable(Path.of("/usr/local/bin/node")) ||
            Files.isExecutable(Path.of("/usr/bin/node"))
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
