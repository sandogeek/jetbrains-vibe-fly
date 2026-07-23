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
  registerHost2AgentService,
  type AgentConnection,
  type Host2AgentService,
} from "./generated/controlRpc.js"
import { log } from "./log.js"
import {
  createAgentWsServer,
  createTicketStore,
  isValidOrigin,
} from "./ws.js"

async function main(): Promise<void> {
  console.log = (...args: unknown[]) => {
    console.error("[vibefly-agent:stdout-redirect]", ...args)
  }

  const ticketStore = createTicketStore()
  const wsServer = createAgentWsServer({ ticketStore })
  log("ws listening", wsServer.url)

  let shuttingDown = false

  const peer = createStdioSimpleRpc({
    input: process.stdin,
    output: process.stdout,
    onClosed: () => {
      log("stdio closed")
      teardown(0)
    },
  })

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
      log("shutdown requested")
      teardown(0)
    },
    async generateCommitMessage(request) {
      return generateCommitMessage(request)
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

  log("agent ready")

  function teardown(code: number): void {
    if (shuttingDown) return
    shuttingDown = true
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
  log("fatal", error)
  process.exit(1)
})
