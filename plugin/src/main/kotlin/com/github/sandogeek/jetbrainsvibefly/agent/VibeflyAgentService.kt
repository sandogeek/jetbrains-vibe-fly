package com.github.sandogeek.jetbrainsvibefly.agent

import com.github.sandogeek.jetbrainsvibefly.settings.Agent2HostBridge
import com.github.sandogeek.jetbrainsvibefly.settings.CommitMessageProgressListener
import com.github.sandogeek.jetbrainsvibefly.settings.VibeflyProviderSettingsState
import com.github.sandogeek.simplerpc.RpcSession
import com.github.sandogeek.simplerpc.stdio.StdioRpcTransport
import com.github.sandogeek.vibefly.jcef.AgentOrigin
import com.github.sandogeek.vibefly.jcef.rpc.AgentConnection
import com.github.sandogeek.vibefly.jcef.rpc.GenerateCommitMessageRequest
import com.github.sandogeek.vibefly.jcef.rpc.GenerateCommitMessageResult
import com.github.sandogeek.vibefly.jcef.rpc.Host2Agent
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlin.time.Duration.Companion.milliseconds

/**
 * Project-level Bun agent lifecycle over stdio SimpleRpc control plane.
 * UI business traffic uses a separate authenticated WebSocket (not stdio).
 */
@Service(Service.Level.PROJECT)
class VibeflyAgentService(private val project: Project) : Disposable {

    private val mutex = Mutex()
    private val processRef = AtomicReference<Process?>(null)
    private val transportRef = AtomicReference<StdioRpcTransport?>(null)
    private val sessionRef = AtomicReference<RpcSession?>(null)
    private val host2AgentRef = AtomicReference<Host2Agent?>(null)

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
        val startedAt = System.nanoTime()
        fun elapsedMs(): Long = (System.nanoTime() - startedAt) / 1_000_000L

        val ensureStartedAt = System.nanoTime()
        ensureStarted()
        val ensureMs = (System.nanoTime() - ensureStartedAt) / 1_000_000L

        val control = host2AgentRef.get()
            ?: error("Agent control API is not available")

        val ticketStartedAt = System.nanoTime()
        val connection = control.openWebSocketSession(expectedOrigin)
        val ticketMs = (System.nanoTime() - ticketStartedAt) / 1_000_000L

        log.info(
            "openSession done origin=$expectedOrigin " +
                "ensureMs=$ensureMs ticketMs=$ticketMs totalMs=${elapsedMs()} " +
                "url=${connection.url}",
        )
        return connection
    }

    /**
     * Generate a conventional commit message from included change summaries/diff.
     * Starts the agent on demand.
     *
     * Timeout is **idle-based**: agent [com.github.sandogeek.vibefly.jcef.rpc.Agent2Host.reportCommitMessageProgress]
     * keep-alives reset the deadline. Only a quiet gap of [timeoutMs] fails —
     * ongoing generation (slow models, long streams) is not cut off by wall clock.
     */
    suspend fun generateCommitMessage(
        request: GenerateCommitMessageRequest,
        timeoutMs: Long = DEFAULT_COMMIT_MESSAGE_TIMEOUT_MS,
        onProgress: (String) -> Unit = {},
    ): GenerateCommitMessageResult {
        ensureStarted()
        val control = host2AgentRef.get()
            ?: error("Agent control API is not available")
        return withIdleTimeout(
            idleTimeoutMs = timeoutMs,
            onProgress = onProgress,
        ) {
            control.generateCommitMessage(request)
        }
    }

    /**
     * Run [block] while listening for commit-generation progress reverse-RPC.
     * Each progress event resets the idle deadline; absolute wall-clock is not used.
     */
    private suspend fun <T> withIdleTimeout(
        idleTimeoutMs: Long,
        onProgress: (String) -> Unit = {},
        block: suspend () -> T,
    ): T {
        val idleMs = idleTimeoutMs.coerceAtLeast(1L)
        val lastProgressAt = AtomicLong(System.nanoTime())
        val listener = CommitMessageProgressListener { message ->
            lastProgressAt.set(System.nanoTime())
            onProgress(message)
        }
        return Agent2HostBridge.withCommitProgressSuspend(listener) {
            coroutineScope {
                val work = async { block() }
                val watchdog = launch {
                    val idleNanos = idleMs * 1_000_000L
                    while (isActive) {
                        val elapsed = System.nanoTime() - lastProgressAt.get()
                        val remainingMs =
                            ((idleNanos - elapsed) / 1_000_000L).coerceAtLeast(1L)
                        delay(remainingMs.coerceAtMost(idleMs).milliseconds)
                        val quietFor = System.nanoTime() - lastProgressAt.get()
                        if (quietFor >= idleNanos) {
                            // TimeoutCancellationException ctor is internal; plain error cancels siblings.
                            error(
                                "Timed out waiting for commit message progress after ${idleMs}ms of silence",
                            )
                        }
                    }
                }
                try {
                    work.await()
                } finally {
                    watchdog.cancel()
                }
            }
        }
    }

    suspend fun ensureStarted() {
        if (disposed) error("VibeflyAgentService is disposed")
        mutex.withLock {
            if (disposed) error("VibeflyAgentService is disposed")
            val existing = processRef.get()
            if (existing != null && existing.isAlive && host2AgentRef.get() != null) {
                state = State.READY
                log.debug("ensureStarted reuse alive agent pid=${existing.pid()}")
                return
            }
            val startedAt = System.nanoTime()
            stopLocked()
            state = State.STARTING
            try {
                startLocked()
                state = State.READY
                val totalMs = (System.nanoTime() - startedAt) / 1_000_000L
                val pid = processRef.get()?.pid()
                log.info("ensureStarted cold start ready pid=$pid totalMs=$totalMs")
            } catch (e: Exception) {
                state = State.FAILED
                stopLocked()
                val totalMs = (System.nanoTime() - startedAt) / 1_000_000L
                log.warn("ensureStarted cold start failed totalMs=$totalMs", e)
                throw e
            }
        }
    }

    suspend fun stopIfRunning() {
        mutex.withLock {
            stopLocked()
        }
    }

    /**
     * Ensure the project agent is running, then run [block] on its Host2Agent control plane.
     */
    suspend fun <T> withControl(
        timeoutMs: Long = DEFAULT_CONFIG_TIMEOUT_MS,
        block: suspend (Host2Agent) -> T,
    ): T {
        ensureStarted()
        val control = host2AgentRef.get()
            ?: error("Agent control API is not available")
        return withTimeout(timeoutMs.milliseconds) {
            block(control)
        }
    }

    private fun startLocked() {
        val settings = VibeflyProviderSettingsState.getInstance()
        val handle = VibeflyAgentProcess.start(
            agentDir = VibeflyAgentDirectory.current(),
            projectRoot = project.basePath,
            defaultModel = settings.defaultModelSpec(),
        )
        processRef.set(handle.process)
        transportRef.set(handle.transport)
        sessionRef.set(handle.session)
        host2AgentRef.set(handle.control)
    }

    private fun stopLocked() {
        val control = host2AgentRef.getAndSet(null)
        if (control != null) {
            try {
                runBlocking {
                    withTimeout(3_000.milliseconds) {
                        control.shutdown()
                    }
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
        private val settingsControlSequence = AtomicLong()

        const val DEFAULT_COMMIT_MESSAGE_TIMEOUT_MS: Long = 90_000L
        const val DEFAULT_CONFIG_TIMEOUT_MS: Long = 60_000L

        fun getInstance(project: Project): VibeflyAgentService =
            project.getService(VibeflyAgentService::class.java)

        /**
         * Settings / Host2Agent control calls always use the current project's agent.
         * Starts it on demand; never spawns a short-lived one-shot process.
         */
        fun <T> withControlForSettings(
            project: Project? = null,
            timeoutMs: Long = DEFAULT_CONFIG_TIMEOUT_MS,
            operation: String = "settingsControl",
            block: suspend (Host2Agent) -> T,
        ): T {
            val requestId = settingsControlSequence.incrementAndGet()
            val startedAt = System.nanoTime()
            fun elapsedMs(): Long = (System.nanoTime() - startedAt) / 1_000_000L

            val target = resolveProject(project)
                ?: error("No open project available for Host2Agent call ($operation)")
            val service = getInstance(target)
            log.info(
                "$operation start request=$requestId source=project-agent " +
                    "project=${target.name}",
            )
            return try {
                val value = runBlocking {
                    service.withControl(timeoutMs = timeoutMs, block = block)
                }
                log.info(
                    "$operation done request=$requestId source=project-agent " +
                        "elapsedMs=${elapsedMs()}",
                )
                value
            } catch (e: Exception) {
                log.warn(
                    "$operation failed request=$requestId source=project-agent " +
                        "elapsedMs=${elapsedMs()}",
                    e,
                )
                throw e
            }
        }

        private fun resolveProject(preferred: Project?): Project? {
            preferred?.takeUnless { it.isDisposed }?.let { return it }
            return ProjectManager.getInstance().openProjects.firstOrNull { !it.isDisposed }
        }

        /**
         * Stop agents in all open projects after Settings apply.
         * Always runs off the EDT to avoid blocking the Settings Apply UI.
         */
        fun stopAllOpenProjects() {
            val work = Runnable {
                for (project in ProjectManager.getInstance().openProjects) {
                    if (project.isDisposed) continue
                    try {
                        val service = project.getService(VibeflyAgentService::class.java) ?: continue
                        runBlocking {
                            service.stopIfRunning()
                        }
                    } catch (e: Exception) {
                        log.debug("stop agent for project failed", e)
                    }
                }
            }
            val app = ApplicationManager.getApplication()
            if (app.isDispatchThread) {
                app.executeOnPooledThread(work)
            } else {
                work.run()
            }
        }
    }
}
