package com.github.sandogeek.jetbrainsvibefly.agent

import com.github.sandogeek.simplerpc.RpcSession
import com.github.sandogeek.simplerpc.SimpleRpc
import com.github.sandogeek.simplerpc.stdio.StdioRpcTransport
import com.github.sandogeek.vibefly.jcef.AgentOrigin
import com.github.sandogeek.vibefly.jcef.rpc.AgentConnection
import com.github.sandogeek.vibefly.jcef.rpc.Host2Agent
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicReference

/**
 * Project-level Bun agent lifecycle over stdio SimpleRpc control plane.
 * UI business traffic uses a separate authenticated WebSocket (not stdio).
 */
@Service(Service.Level.PROJECT)
class VibeflyAgentService(@Suppress("unused") private val project: Project) : Disposable {

    private val mutex = Mutex()
    private val processRef = AtomicReference<Process?>(null)
    private val transportRef = AtomicReference<StdioRpcTransport?>(null)
    private val sessionRef = AtomicReference<RpcSession?>(null)
    private val controlRef = AtomicReference<Host2Agent?>(null)

    @Volatile
    private var disposed = false

    enum class State {
        STOPPED,
        STARTING,
        READY,
        FAILED,
    }

    @Volatile
    var state: State = State.STOPPED
        private set

    /**
     * Ensure the agent process is running, then open a one-time WebSocket session
     * bound to [expectedOrigin] (computed by Kotlin from the panel URL).
     */
    suspend fun openSession(expectedOrigin: String = AgentOrigin.currentPanel()): AgentConnection {
        ensureStarted()
        val control = controlRef.get()
            ?: error("Agent control API is not available")
        return control.openWebSocketSession(expectedOrigin)
    }

    suspend fun ensureStarted() {
        if (disposed) error("VibeflyAgentService is disposed")
        mutex.withLock {
            if (disposed) error("VibeflyAgentService is disposed")
            val existing = processRef.get()
            if (existing != null && existing.isAlive && controlRef.get() != null) {
                state = State.READY
                return
            }
            stopLocked()
            state = State.STARTING
            try {
                startLocked()
                state = State.READY
            } catch (e: Exception) {
                state = State.FAILED
                stopLocked()
                throw e
            }
        }
    }

    private fun startLocked() {
        val entry = resolveAgentEntry()
        val command = mutableListOf(resolveBunCommand())
        command.addAll(resolveBunInspectArgs())
        command.add(entry.toString())
        log.info("Starting vibefly-agent: ${command.joinToString(" ")}")

        val process = ProcessBuilder(command)
            .directory(entry.parent?.parent?.toFile()) // packages/vibefly-agent
            .redirectError(ProcessBuilder.Redirect.INHERIT)
            .start()
        processRef.set(process)

        val transport = StdioRpcTransport(
            input = process.inputStream,
            output = process.outputStream,
            onClosed = {
                log.info("Agent stdio closed")
            },
        )
        transportRef.set(transport)
        val session = SimpleRpc.open(transport)
        sessionRef.set(session)
        val control = session.proxy(Host2Agent::class.java)
        controlRef.set(control)
    }

    private fun stopLocked() {
        val control = controlRef.getAndSet(null)
        if (control != null) {
            try {
                runBlocking {
                    control.shutdown()
                }
            } catch (e: Exception) {
                log.debug("agent shutdown() failed", e)
            }
        }
        sessionRef.getAndSet(null)?.close()
        transportRef.getAndSet(null)?.close()
        val process = processRef.getAndSet(null)
        if (process != null) {
            process.destroy()
            try {
                if (!process.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)) {
                    process.destroyForcibly()
                }
            } catch (_: Exception) {
                process.destroyForcibly()
            }
        }
        state = State.STOPPED
    }

    override fun dispose() {
        disposed = true
        runBlocking {
            mutex.withLock {
                stopLocked()
            }
        }
    }

    companion object {
        private val log = logger<VibeflyAgentService>()

        fun getInstance(project: Project): VibeflyAgentService =
            project.getService(VibeflyAgentService::class.java)

        private fun resolveBunCommand(): String {
            System.getProperty("vibefly.bun")?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
            System.getenv("VIBEFLY_BUN")?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
            return "bun"
        }

        /**
         * Bun CDP debugger flags for Attach to Node.js/Chrome.
         *
         * - `-Dvibefly.agent.inspect=true` → `--inspect` (Bun default port)
         * - `-Dvibefly.agent.inspect=6499` or `127.0.0.1:6499` → `--inspect=<value>`
         * - `-Dvibefly.agent.inspect.mode=wait|brk` → `--inspect-wait` / `--inspect-brk`
         * - env `VIBEFLY_AGENT_INSPECT` / `VIBEFLY_AGENT_INSPECT_MODE` as fallback
         */
        private fun resolveBunInspectArgs(): List<String> {
            val raw = System.getProperty("vibefly.agent.inspect")?.trim().orEmpty()
                .ifEmpty { System.getenv("VIBEFLY_AGENT_INSPECT")?.trim().orEmpty() }
            if (raw.isEmpty() || raw.equals("false", ignoreCase = true) || raw == "0") {
                return emptyList()
            }
            val mode = System.getProperty("vibefly.agent.inspect.mode")?.trim().orEmpty()
                .ifEmpty { System.getenv("VIBEFLY_AGENT_INSPECT_MODE")?.trim().orEmpty() }
                .lowercase()
            val flag = when (mode) {
                "wait" -> "--inspect-wait"
                "brk" -> "--inspect-brk"
                else -> "--inspect"
            }
            return if (raw.equals("true", ignoreCase = true) || raw == "1") {
                listOf(flag)
            } else {
                listOf("$flag=$raw")
            }
        }

        private fun resolveAgentEntry(): Path {
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
            // Sandbox IDE often has user.dir under the IDE install or idea-sandbox, not monorepo.
            val searchRoots = linkedSetOf<Path>()
            System.getProperty("user.dir")?.let {
                searchRoots.add(Path.of(it).toAbsolutePath().normalize())
            }
            System.getenv("VIBEFLY_REPO_ROOT")?.trim()?.takeIf { it.isNotEmpty() }?.let {
                searchRoots.add(Path.of(it).toAbsolutePath().normalize())
            }
            // Walk up each root looking for monorepo packages/vibefly-agent.
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
}
