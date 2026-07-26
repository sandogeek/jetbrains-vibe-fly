/**
 * Vibe Fly Bun agent entrypoint.
 * stdout: SimpleRpc Content-Length frames only (control plane)
 * stderr: logs
 * WebSocket: UI business SimpleRpc after ticket handshake
 */
import { createStdioSimpleRpc } from "@sandogeek/simple-rpc-bun"
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

async function main(): Promise<void> {
  console.log = (...args: unknown[]) => {
    console.error("[vibefly-agent:stdout-redirect]", ...args)
  }

  const agentDir = applyAgentDirFromEnv()
  log.info("agentDir", { agentDir })
  // Warm OMP auth + model registry (no secrets in env).
  try {
    await getOmpRuntime()
  } catch (error) {
    log.warn("omp runtime warm failed", { err: error })
  }

  const ticketStore = createTicketStore()
  const wsServer = createAgentWsServer({ ticketStore })
  log.info("ws listening", { url: wsServer.url })

  let shuttingDown = false

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
    async generateCommitMessage(request) {
      return generateCommitMessage(request)
    },
    async getProvidersSnapshot(agentDir) {
      return getProvidersSnapshot(agentDir)
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
    }
    registerUi2AgentService(wsPeer, ui2AgentImpl)
  })

  log.info("agent ready")

  function teardown(code: number): void {
    if (shuttingDown) return
    shuttingDown = true
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
