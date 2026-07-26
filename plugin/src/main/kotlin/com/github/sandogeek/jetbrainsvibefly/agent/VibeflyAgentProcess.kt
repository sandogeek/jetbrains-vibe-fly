package com.github.sandogeek.jetbrainsvibefly.agent

import com.github.sandogeek.jetbrainsvibefly.settings.Agent2HostBridge
import com.github.sandogeek.simplerpc.RpcSession
import com.github.sandogeek.simplerpc.SimpleRpc
import com.github.sandogeek.simplerpc.stdio.StdioRpcTransport
import com.github.sandogeek.vibefly.jcef.rpc.Host2Agent
import com.intellij.openapi.diagnostic.logger
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.minutes

/**
 * Shared Bun agent process launcher for project lifecycle and one-shot Settings RPC.
 */
object VibeflyAgentProcess {
    private val log = logger<VibeflyAgentProcess>()

    /** OAuth login can wait on browser callback for several minutes. */
    val CONTROL_REQUEST_TIMEOUT: Duration = 6.minutes

    data class Handle(
        val process: Process,
        val transport: StdioRpcTransport,
        val session: RpcSession,
        val control: Host2Agent,
    ) {
        fun close() {
            try {
                runBlocking {
                    withTimeout(3_000.milliseconds) {
                        control.shutdown()
                    }
                }
            } catch (e: Exception) {
                log.debug("agent shutdown() failed", e)
            }
            try {
                session.close()
            } catch (_: Exception) {
            }
            try {
                transport.close()
            } catch (_: Exception) {
            }
            if (process.isAlive) {
                process.destroy()
                try {
                    if (!process.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)) {
                        process.destroyForcibly()
                    }
                } catch (_: Exception) {
                    process.destroyForcibly()
                }
            }
        }
    }

    fun start(
        agentDir: String? = null,
    ): Handle {
        val entry = VibeflyAgentPaths.resolveAgentEntry()
        val bun = VibeflyAgentPaths.resolveBunCommand()
        val workDir = VibeflyAgentPaths.resolveAgentWorkingDirectory(entry)
        val command = mutableListOf(bun)
        command.addAll(resolveBunInspectArgs())
        command.add(entry.toString())
        log.info(
            "Starting vibefly-agent: ${command.joinToString(" ")} (cwd=$workDir)",
        )

        val builder = ProcessBuilder(command)
            .directory(workDir.toFile())
            .redirectError(ProcessBuilder.Redirect.INHERIT)

        val env = builder.environment()
        val dir = agentDir?.trim().orEmpty()
        if (dir.isNotEmpty()) {
            // Internal process param for OMP agent dir (not commit config).
            env["PI_CODING_AGENT_DIR"] = dir
        }

        val process = try {
            builder.start()
        } catch (e: Exception) {
            throw IllegalStateException(
                "Failed to start vibefly-agent with bun=$bun entry=$entry cwd=$workDir. " +
                    "Install Bun (https://bun.sh) or set -Dvibefly.bun=/path/to/bun.",
                e,
            )
        }
        val transport = StdioRpcTransport(
            input = process.inputStream,
            output = process.outputStream,
            onClosed = { log.info("Agent stdio closed") },
        )
        val session = SimpleRpc.open(transport, requestTimeout = CONTROL_REQUEST_TIMEOUT)
        session.registerImplementation(Agent2HostBridge)
        val control = session.proxy(Host2Agent::class.java)
        return Handle(process, transport, session, control)
    }

    /**
     * Run a one-shot control-plane call against a short-lived agent process.
     */
    fun <T> withControl(
        agentDir: String? = null,
        timeoutMs: Long = 60_000L,
        block: suspend (Host2Agent) -> T,
    ): T {
        val handle = start(agentDir = agentDir)
        try {
            return runBlocking {
                withTimeout(timeoutMs.milliseconds) {
                    block(handle.control)
                }
            }
        } finally {
            handle.close()
        }
    }

    fun resolveBunInspectArgs(): List<String> {
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
}
