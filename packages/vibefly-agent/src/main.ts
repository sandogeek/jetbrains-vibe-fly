/**
 * Vibe Fly Bun agent entrypoint.
 * stdout: SimpleRpc Content-Length frames only (control plane)
 * stderr: logs
 * WebSocket: UI business SimpleRpc after ticket handshake
 */
import { createStdioSimpleRpc } from "@sandogeek/simple-rpc-bun"
import { rpcOptions } from "@sandogeek/simple-rpc"
import {
  createAgent2UiProxy,
  registerUi2AgentService,
  type Agent2Ui,
  type Ui2AgentService,
} from "@vibefly/uiagent-shared"
import { generateCommitMessage } from "./commitMessage.js"
import {
  createAgent2HostProxy,
  registerHost2AgentService,
  type AgentConnection,
  type Host2AgentService,
} from "./generated/controlRpc.js"
import { log } from "./log.js"
import { ChatSessionRegistry } from "./chatSessionRegistry.js"
import { applyAgentDirFromEnv, clearOmpRuntimeCache, getOmpRuntime } from "./ompRuntime.js"
import {
  applyProvidersPatch,
  getProvidersSnapshot,
} from "./providerConfig.js"
import {
  cancelActiveLogin,
  getLoginProviders,
  loginProvider,
  logoutProvider,
} from "./providerLogin.js"
import {
  createAgentWsServer,
  createTicketStore,
  isValidOrigin,
} from "./ws.js"

/** Fire-and-forget reverse RPC; host resets idle timeout on each call. */
const progressOpts = rpcOptions({ timeoutMs: 5_000 })

async function main(): Promise<void> {
  const bootStarted = performance.now()
  console.log = (...args: unknown[]) => {
    console.error("[vibefly-agent:stdout-redirect]", ...args)
  }

  const agentDirStarted = performance.now()
  const agentDir = applyAgentDirFromEnv()
  log.info("agentDir", {
    agentDir,
    elapsedMs: Math.round(performance.now() - agentDirStarted),
  })

  // Warm OMP auth + model registry (no secrets in env).
  const ompWarmStarted = performance.now()
  try {
    await getOmpRuntime()
    log.info("omp runtime warm done", {
      elapsedMs: Math.round(performance.now() - ompWarmStarted),
    })
  } catch (error) {
    log.warn("omp runtime warm failed", {
      err: error,
      elapsedMs: Math.round(performance.now() - ompWarmStarted),
    })
  }

  const wsStarted = performance.now()
  const ticketStore = createTicketStore()
  const wsServer = createAgentWsServer({ ticketStore })
  log.info("ws listening", {
    url: wsServer.url,
    elapsedMs: Math.round(performance.now() - wsStarted),
  })

  let shuttingDown = false
  const chatSessions = new ChatSessionRegistry(
    process.env.VIBEFLY_PROJECT_ROOT,
    process.env.VIBEFLY_DEFAULT_MODEL,
  )

  const peer = createStdioSimpleRpc({
    input: process.stdin,
    output: process.stdout,
    onClosed: () => {
      log.info("stdio closed")
      teardown(0)
    },
  })

  const agent2Host = createAgent2HostProxy(peer)

  const controlImpl: Host2AgentService = {
    openWebSocketSession(expectedOrigin: string): AgentConnection {
      if (!isValidOrigin(expectedOrigin)) {
        throw new Error(`invalid expectedOrigin: ${expectedOrigin}`)
      }
      const { ticket, expiresAtEpochMs } = ticketStore.create(expectedOrigin)
      return {
        url: wsServer.url,
        ticket,
        expiresAtEpochMs,
      }
    },
    shutdown() {
      log.info("shutdown requested")
      teardown(0)
    },
    async generateCommitMessage(request, ctx) {
      return generateCommitMessage(request, {
        signal: ctx?.signal,
        onProgress: (message) => {
          void agent2Host
            .reportCommitMessageProgress(message, progressOpts)
            .catch(() => {})
        },
      })
    },
    async getProvidersSnapshot(agentDir, ctx) {
      return getProvidersSnapshot(agentDir, { requestId: ctx?.requestId })
    },
    async applyProvidersPatch(request) {
      const result = await applyProvidersPatch(request)
      if (result.ok) {
        clearOmpRuntimeCache()
        try {
          await getOmpRuntime({ forceNew: true, agentDir: request.agentDir })
        } catch (error) {
          log.warn("omp reload after patch failed", { err: error })
        }
      }
      return result
    },
    async getLoginProviders(agentDir) {
      return getLoginProviders(agentDir)
    },
    async loginProvider(request) {
      const result = await loginProvider(request, agent2Host)
      if (result.ok) {
        clearOmpRuntimeCache()
        try {
          await getOmpRuntime({ forceNew: true, agentDir: request.agentDir })
        } catch (error) {
          log.warn("omp reload after login failed", { err: error })
        }
      }
      return result
    },
    async logoutProvider(request) {
      const result = await logoutProvider(request)
      if (result.ok) {
        clearOmpRuntimeCache()
        try {
          await getOmpRuntime({ forceNew: true, agentDir: request.agentDir })
        } catch (error) {
          log.warn("omp reload after logout failed", { err: error })
        }
      }
      return result
    },
    cancelProviderLogin() {
      cancelActiveLogin()
    },
  }
  registerHost2AgentService(peer, controlImpl)

  let taskSeq = 0
  wsServer.setSessionFactory((wsPeer) => {
    const agent2Ui: Agent2Ui = createAgent2UiProxy(wsPeer)
    chatSessions.attach(agent2Ui)
    const ui2AgentImpl: Ui2AgentService = {
      ping(text: string) {
        return `pong:${text}`
      },
      startTask(request) {
        taskSeq += 1
        const taskId = `task-${taskSeq}`
        const message = request.prompt.slice(0, 200)
        queueMicrotask(() => {
          void agent2Ui
            .onAgentEvent({
              kind: "log",
              message: `started ${taskId}: ${message}`,
            })
            .catch(() => {})
          void agent2Ui
            .onAgentEvent({
              kind: "taskDone",
              taskId,
              ok: true,
              message: "mvp stub complete",
            })
            .catch(() => {})
        })
        return taskId
      },
      listChatSessions(request) {
        return chatSessions.listChatSessions(request)
      },
      listRecentChatSessions(request) {
        return chatSessions.listRecentChatSessions(request)
      },
      openChatSession(request) {
        return chatSessions.openChatSession(request)
      },
      createChatSession(request) {
        return chatSessions.createChatSession(request)
      },
      releaseChatSession(sessionId) {
        return chatSessions.releaseChatSession(sessionId)
      },
      sendChatMessage(request) {
        return chatSessions.sendChatMessage(request)
      },
      cancelQueuedTurn(sessionId) {
        chatSessions.cancelQueuedTurn(sessionId)
      },
      abortChatTurn(sessionId) {
        return chatSessions.abortChatTurn(sessionId)
      },
      listChatModels(sessionId) {
        return chatSessions.listChatModels(sessionId)
      },
      setChatModel(sessionId, modelId) {
        return chatSessions.setChatModel(sessionId, modelId)
      },
      setChatThinkingLevel(sessionId, level) {
        return chatSessions.setChatThinkingLevel(sessionId, level)
      },
      markChatSessionRead(sessionId) {
        chatSessions.markChatSessionRead(sessionId)
      },
    }
    registerUi2AgentService(wsPeer, ui2AgentImpl)
    return () => {
      void chatSessions.disconnect()
    }
  })

  log.info("agent ready", {
    totalMs: Math.round(performance.now() - bootStarted),
  })

  function teardown(code: number): void {
    if (shuttingDown) return
    shuttingDown = true
    try {
      void chatSessions.dispose()
    } catch {
      // ignore
    }
    try {
      clearOmpRuntimeCache()
    } catch {
      // ignore
    }
    try {
      ticketStore.clear()
    } catch {
      // ignore
    }
    try {
      wsServer.close()
    } catch {
      // ignore
    }
    try {
      peer.close()
    } catch {
      // ignore
    }
    process.exit(code)
  }

  process.on("SIGINT", () => teardown(0))
  process.on("SIGTERM", () => teardown(0))
}

main().catch((error) => {
  log.error("fatal", { err: error })
  process.exit(1)
})
