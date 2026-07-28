package com.github.sandogeek.jetbrainsvibefly.agent

import com.github.sandogeek.jetbrainsvibefly.settings.Agent2HostBridge
import com.github.sandogeek.jetbrainsvibefly.settings.CommitMessageProgressListener
import com.github.sandogeek.jetbrainsvibefly.settings.ProvidersSettingsLoader
import com.github.sandogeek.jetbrainsvibefly.settings.VibeflyProviderSettingsState

import com.github.sandogeek.simplerpc.RpcSession
import com.github.sandogeek.simplerpc.stdio.StdioRpcTransport
import com.github.sandogeek.vibefly.jcef.AgentOrigin
import com.github.sandogeek.vibefly.jcef.rpc.AgentConnection
import com.github.sandogeek.vibefly.jcef.rpc.GenerateCommitMessageRequest
import com.github.sandogeek.vibefly.jcef.rpc.GenerateCommitMessageResult
import com.github.sandogeek.vibefly.jcef.rpc.Host2Agent
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersPatchRequest
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersPatchResult
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersSnapshot
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

    suspend fun getProvidersSnapshot(
        agentDir: String,
        timeoutMs: Long = DEFAULT_CONFIG_TIMEOUT_MS,
    ): ProvidersSnapshot {
        ensureStarted()
        val control = host2AgentRef.get()
            ?: error("Agent control API is not available")
        return withTimeout(timeoutMs.milliseconds) {
            control.getProvidersSnapshot(agentDir)
        }
    }

    suspend fun applyProvidersPatch(
        request: ProvidersPatchRequest,
        timeoutMs: Long = DEFAULT_CONFIG_TIMEOUT_MS,
    ): ProvidersPatchResult {
        ensureStarted()
        val control = host2AgentRef.get()
            ?: error("Agent control API is not available")
        return withTimeout(timeoutMs.milliseconds) {
            control.applyProvidersPatch(request)
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
                onAgentBecameReady()
            } catch (e: Exception) {
                state = State.FAILED
                stopLocked()
                val totalMs = (System.nanoTime() - startedAt) / 1_000_000L
                log.warn("ensureStarted cold start failed totalMs=$totalMs", e)
                throw e
            }
        }
    }

    /**
     * Fresh start → READY only: warm providers cache for the next Settings open.
     * Settings UI reloads via RPC on mount / Reload.
     */
    private fun onAgentBecameReady() {
        val control = host2AgentRef.get() ?: return
        val agentDir = VibeflyProviderSettingsState.getInstance().resolvedAgentDir()
        ApplicationManager.getApplication().executeOnPooledThread {
            if (disposed || host2AgentRef.get() !== control) return@executeOnPooledThread
            try {
                runBlocking {
                    withTimeout(DEFAULT_CONFIG_TIMEOUT_MS.milliseconds) {
                        ProvidersSettingsLoader.fetchWith(control, agentDir)
                    }
                }
                log.debug("providers cache warmed after agent ready")
            } catch (e: Exception) {
                log.debug("providers cache warmup after agent ready failed", e)
            }
        }
    }

    suspend fun stopIfRunning() {
        mutex.withLock {
            stopLocked()
        }
    }

    /**
     * Run [block] on an already-live control plane without starting the agent.
     * Returns null when this service has no ready process (caller should fall back).
     */
    fun <T> tryWithReadyControl(
        timeoutMs: Long = DEFAULT_CONFIG_TIMEOUT_MS,
        block: suspend (Host2Agent) -> T,
    ): ReadyControlResult<T>? {
        if (disposed) return null
        val control = host2AgentRef.get() ?: return null
        val process = processRef.get()
        if (process == null || !process.isAlive) return null
        return try {
            val value = runBlocking {
                withTimeout(timeoutMs.milliseconds) {
                    block(control)
                }
            }
            ReadyControlResult(value)
        } catch (e: Exception) {
            log.debug("tryWithReadyControl failed", e)
            null
        }
    }

    private fun startLocked() {
        val settings = VibeflyProviderSettingsState.getInstance()
        val handle = VibeflyAgentProcess.start(
            agentDir = settings.resolvedAgentDir(),
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

        const val DEFAULT_COMMIT_MESSAGE_TIMEOUT_MS: Long = 90_000L
        const val DEFAULT_CONFIG_TIMEOUT_MS: Long = 60_000L

        fun getInstance(project: Project): VibeflyAgentService =
            project.getService(VibeflyAgentService::class.java)

        /**
         * Settings / one-shot control calls: reuse any already-running project agent
         * (avoids Bun cold start), otherwise spawn a short-lived process.
         */
        fun <T> withControlForSettings(
            agentDir: String? = null,
            timeoutMs: Long = DEFAULT_CONFIG_TIMEOUT_MS,
            block: suspend (Host2Agent) -> T,
        ): T {
            for (project in ProjectManager.getInstance().openProjects) {
                if (project.isDisposed) continue
                val service = try {
                    project.getService(VibeflyAgentService::class.java)
                } catch (_: Exception) {
                    null
                } ?: continue
                val reused = service.tryWithReadyControl(timeoutMs, block)
                if (reused != null) {
                    log.debug("withControlForSettings reused project agent")
                    return reused.value
                }
            }
            return VibeflyAgentProcess.withControl(
                agentDir = agentDir,
                timeoutMs = timeoutMs,
                block = block,
            )
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

/** Distinguishes a successful ready-control call (value may be null) from "not ready". */
class ReadyControlResult<T>(val value: T)
