package com.github.sandogeek.jetbrainsvibefly.agent

import com.github.sandogeek.simplerpc.RpcSession
import com.github.sandogeek.simplerpc.SimpleRpc
import com.github.sandogeek.simplerpc.stdio.StdioRpcTransport
import com.github.sandogeek.vibefly.jcef.rpc.Host2Agent
import com.intellij.openapi.diagnostic.logger
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.time.Duration.Companion.milliseconds

/**
 * Shared Bun agent process launcher for project lifecycle and one-shot Settings RPC.
 */
object VibeflyAgentProcess {
    private val log = logger<VibeflyAgentProcess>()

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
        defaultModel: String? = null,
    ): Handle {
        val entry = VibeflyAgentPaths.resolveAgentEntry()
        val command = mutableListOf(VibeflyAgentPaths.resolveBunCommand())
        command.addAll(resolveBunInspectArgs())
        command.add(entry.toString())
        log.info("Starting vibefly-agent: ${command.joinToString(" ")}")

        val builder = ProcessBuilder(command)
            .directory(entry.parent?.parent?.toFile()) // packages/vibefly-agent
            .redirectError(ProcessBuilder.Redirect.INHERIT)

        val env = builder.environment()
        val dir = agentDir?.trim().orEmpty()
        if (dir.isNotEmpty()) {
            env["PI_CODING_AGENT_DIR"] = dir
        }
        val model = defaultModel?.trim().orEmpty()
        if (model.isNotEmpty()) {
            env["VIBEFLY_DEFAULT_MODEL"] = model
            // Keep commit path aligned with Settings selection.
            if (env["VIBEFLY_COMMIT_MODEL"].isNullOrBlank()) {
                env["VIBEFLY_COMMIT_MODEL"] = model
            }
        }

        val process = builder.start()
        val transport = StdioRpcTransport(
            input = process.inputStream,
            output = process.outputStream,
            onClosed = { log.info("Agent stdio closed") },
        )
        val session = SimpleRpc.open(transport)
        val control = session.proxy(Host2Agent::class.java)
        return Handle(process, transport, session, control)
    }

    /**
     * Run a one-shot control-plane call against a short-lived agent process.
     */
    fun <T> withControl(
        agentDir: String? = null,
        defaultModel: String? = null,
        timeoutMs: Long = 60_000L,
        block: suspend (Host2Agent) -> T,
    ): T {
        val handle = start(agentDir = agentDir, defaultModel = defaultModel)
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
