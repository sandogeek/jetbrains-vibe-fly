package com.github.sandogeek.jetbrainsvibefly.agent

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.jetbrainsvibefly.VibeflyNotifications
import com.github.sandogeek.jetbrainsvibefly.settings.*
import com.github.sandogeek.jetbrainsvibefly.util.Edt
import com.github.sandogeek.simplerpc.RpcSession
import com.github.sandogeek.simplerpc.stdio.StdioRpcTransport
import com.github.sandogeek.vibefly.jcef.AgentOrigin
import com.github.sandogeek.vibefly.jcef.rpc.AgentConnection
import com.github.sandogeek.vibefly.jcef.rpc.GenerateCommitMessageRequest
import com.github.sandogeek.vibefly.jcef.rpc.GenerateCommitMessageResult
import com.github.sandogeek.vibefly.jcef.rpc.Host2Agent
import com.github.sandogeek.vibefly.jcef.rpc.SettingsChangedNotification
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Duration.Companion.milliseconds

/**
 * Project-level Node agent lifecycle over stdio SimpleRpc control plane.
 * UI business traffic uses a separate authenticated WebSocket (not stdio).
 */
@Service(Service.Level.PROJECT)
class VibeflyAgentService(private val project: Project) : Disposable {

    private val mutex = Mutex()
    private val processRef = AtomicReference<Process?>(null)
    private val transportRef = AtomicReference<StdioRpcTransport?>(null)
    private val sessionRef = AtomicReference<RpcSession?>(null)
    private val host2AgentRef = AtomicReference<Host2Agent?>(null)
    private val settingsNotificationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val projectRoot = VibeflyProjectSettingsService.getInstance(project).projectRoot
    private val startFailureNotified = AtomicBoolean(false)

    init {
        ApplicationManager.getApplication().messageBus
            .connect(this)
            .subscribe(
                VIBEFLY_SETTINGS_TOPIC,
                VibeflySettingsListener(::forwardSettingsChanged),
            )
    }

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
        if (canReuseRunningProcess()) {
            state = State.READY
            log.debug("ensureStarted reuse alive agent pid=${processRef.get()?.pid()}")
            return
        }
        startColdWithProgressIfNeeded()
    }

    private fun canReuseRunningProcess(): Boolean {
        val existing = processRef.get()
        return existing != null && existing.isAlive && host2AgentRef.get() != null
    }

    private suspend fun startColdWithProgressIfNeeded() {
        val existingIndicator = ProgressManager.getGlobalProgressIndicator()
        if (existingIndicator != null) {
            existingIndicator.text = VibeflyBundle.message("agent.start.progress")
            startColdLocked()
            return
        }
        // Do not use platform withBackgroundProgress: its CoroutineScope receiver comes from
        // the IDE classloader, while this plugin ships kotlinx-coroutines via simplerpc.
        val title = VibeflyBundle.message("agent.start.progress")
        val started = CompletableDeferred<Unit>()
        try {
            ProgressManager.getInstance().run(object : Task.Backgroundable(project, title, false) {
                override fun run(indicator: ProgressIndicator) {
                    indicator.isIndeterminate = true
                    indicator.text = title
                    try {
                        runBlocking {
                            startColdLocked()
                        }
                        started.complete(Unit)
                    } catch (error: Throwable) {
                        started.completeExceptionally(error)
                    }
                }
            })
        } catch (error: Throwable) {
            started.completeExceptionally(error)
        }
        started.await()
    }

    private suspend fun startColdLocked() {
        mutex.withLock {
            if (disposed) error("VibeflyAgentService is disposed")
            if (canReuseRunningProcess()) {
                state = State.READY
                log.debug("ensureStarted reuse alive agent pid=${processRef.get()?.pid()}")
                return
            }
            val startedAt = System.nanoTime()
            stopLocked()
            state = State.STARTING
            try {
                startLocked()
                state = State.READY
                startFailureNotified.set(false)
                val totalMs = (System.nanoTime() - startedAt) / 1_000_000L
                val pid = processRef.get()?.pid()
                log.info("ensureStarted cold start ready pid=$pid totalMs=$totalMs")
            } catch (e: CancellationException) {
                state = State.STOPPED
                stopLocked()
                throw e
            } catch (e: Exception) {
                state = State.FAILED
                stopLocked()
                val totalMs = (System.nanoTime() - startedAt) / 1_000_000L
                log.warn("ensureStarted cold start failed totalMs=$totalMs", e)
                notifyStartFailedOnce(e)
                throw e
            }
        }
    }

    private fun notifyStartFailedOnce(error: Exception) {
        if (!startFailureNotified.compareAndSet(false, true)) return
        val detail = error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName
        Edt.later {
            if (disposed) return@later
            VibeflyNotifications.error(
                project,
                VibeflyBundle.message("agent.start.failed.title"),
                VibeflyBundle.message("agent.start.failed", detail),
            )
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
        val handle = VibeflyAgentProcess.start(
            agentDir = VibeflyAgentDirectory.current(),
            projectRoot = project.basePath,
            agent2Host = Agent2HostBridge.bind(project),
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
                runBlocking(NonCancellable) {
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
        settingsNotificationScope.cancel()
        // 2025.3+ project close runs on a cancelled Job. runBlocking inherits that Job
        // and would throw JobCancellationException — ObjectTree forbids CE from dispose().
        try {
            runBlocking(NonCancellable) {
                mutex.withLock {
                    stopLocked()
                }
            }
        } catch (e: CancellationException) {
            log.debug("agent dispose cancelled", e)
        } catch (e: Exception) {
            log.debug("agent dispose failed", e)
        }
    }

    private fun forwardSettingsChanged(event: VibeflySettingsChanged) {
        if (disposed) return
        val applies = event.scope == SETTINGS_SCOPE_APPLICATION ||
                (event.scope == SETTINGS_SCOPE_PROJECT && event.projectRoot == projectRoot)
        if (!applies) return

        settingsNotificationScope.launch {
            if (disposed) return@launch
            val process = processRef.get()
            val control = host2AgentRef.get()
            if (process == null || !process.isAlive || control == null) return@launch
            try {
                control.settingsChanged(SettingsChangedNotification(changes = event.changes))
            } catch (error: Exception) {
                if (!disposed) log.debug("settingsChanged notification failed", error)
            }
        }
    }

    companion object {
        private val log = logger<VibeflyAgentService>()

        const val DEFAULT_COMMIT_MESSAGE_TIMEOUT_MS: Long = 90_000L
        const val DEFAULT_CONFIG_TIMEOUT_MS: Long = 60_000L

        fun getInstance(project: Project): VibeflyAgentService =
            project.getService(VibeflyAgentService::class.java)
    }
}
