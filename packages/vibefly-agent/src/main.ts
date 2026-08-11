/**
 * Vibe Fly Node agent entrypoint.
 * stdout: SimpleRpc Content-Length frames only (control plane)
 * stderr: logs
 * WebSocket: UI business SimpleRpc after ticket handshake
 */
// Must be first: redirects console.* → stderr before other deps evaluate.
import "./stdoutIsolation.js"
import {createStdioSimpleRpc} from "@sandogeek/simple-rpc-node"
import {rpcOptions} from "@sandogeek/simple-rpc"
import {
  type Agent2Ui,
  createAgent2UiProxy,
  registerUi2AgentService,
  type Ui2AgentService,
} from "@vibefly/uiagent-shared"
import {generateCommitMessage} from "./commitMessage.js"
import {
  type AgentConnection,
  createAgent2HostProxy,
  type Host2AgentService,
  registerHost2AgentService,
} from "./generated/controlRpc.js"
import {log} from "./log.js"
import {ChatSessionRegistry} from "./chatSessionRegistry.js"
import {applyAgentDirFromEnv, clearPiRuntimeCache, getPiRuntime} from "./piRuntime.js"
import {getProvidersSnapshot, rejectAgentProviderPatch,} from "./providerConfig.js"
import {cancelActiveLogin, getLoginProviders, loginProvider, logoutProvider,} from "./providerLogin.js"
import {createAgentWsServer, createTicketStore, isValidOrigin,} from "./ws.js"
import {HostSettingsRuntime} from "./hostSettings.js"

/** Fire-and-forget reverse RPC; host resets idle timeout on each call. */
const progressOpts = rpcOptions({ timeoutMs: 5_000 })

async function main(): Promise<void> {
  const bootStarted = performance.now()

  const agentDirStarted = performance.now()
  const agentDir = applyAgentDirFromEnv()
  log.info("agentDir", {
    agentDir,
    elapsedMs: Math.round(performance.now() - agentDirStarted),
  })

  let teardown: (code: number) => void = (code) => process.exit(code)
  const peer = createStdioSimpleRpc({
    input: process.stdin,
    output: process.stdout,
    onClosed: () => {
      log.info("stdio closed")
      teardown(0)
    },
  })
  const agent2Host = createAgent2HostProxy(peer)

  const hostSettings = new HostSettingsRuntime(agent2Host, {
    hasProject: Boolean(process.env.VIBEFLY_PROJECT_ROOT?.trim()),
  })
  await hostSettings.initialize()

  const piWarmStarted = performance.now()
  const piRuntime = await getPiRuntime({
    agentDir,
    credentials: hostSettings.credentials,
    forceNew: true,
  })
  await hostSettings.attachModelRuntime(piRuntime.modelRuntime)
  log.info("host-backed pi runtime ready", {
    elapsedMs: Math.round(performance.now() - piWarmStarted),
  })

  const wsStarted = performance.now()
  const ticketStore = createTicketStore()
  const wsServer = await createAgentWsServer({ ticketStore })
  log.info("ws listening", {
    url: wsServer.url,
    elapsedMs: Math.round(performance.now() - wsStarted),
  })

  let shuttingDown = false
  const chatSessions = new ChatSessionRegistry(
    process.env.VIBEFLY_PROJECT_ROOT,
      undefined,
      {settingsStorage: hostSettings.settingsStorage},
  )
  hostSettings.setReloadLiveSessions((modelCatalogChanged) =>
      chatSessions.reloadLiveSessions(modelCatalogChanged))

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
      return generateCommitMessage(hostSettings.applyCommitSettings(request), {
        signal: ctx?.signal,
        onProgress: (message) => {
          void agent2Host
            .reportCommitMessageProgress(message, progressOpts)
            .catch(() => {})
        },
      })
    },
    settingsChanged(scope: string, projectRoot: string | null, revision: string) {
      return hostSettings.handleSettingsChanged(scope, projectRoot, revision)
    },
    async getProvidersSnapshot() {
      return getProvidersSnapshot(piRuntime)
    },
    async applyProvidersPatch() {
      return rejectAgentProviderPatch()
    },
    async getLoginProviders() {
      return getLoginProviders(piRuntime)
    },
    async loginProvider(request) {
      return loginProvider(request, agent2Host, piRuntime)
    },
    async logoutProvider(request) {
      return logoutProvider(request, piRuntime)
    },
    cancelProviderLogin() {
      cancelActiveLogin()
    },
  }
  wsServer.setSessionFactory((wsPeer) => {
    const agent2Ui: Agent2Ui = createAgent2UiProxy(wsPeer)
    chatSessions.attach(agent2Ui)
    const ui2AgentImpl: Ui2AgentService = {
      ping(text: string) {
        return `pong:${text}`
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

  registerHost2AgentService(peer, controlImpl)
  // Settings can change after the initial snapshot but before Host2Agent is
  // registered. Re-read both scopes once the control service can no longer
  // miss invalidations; subsequent notifications are serialized normally.
  await hostSettings.refreshFromHost()

  log.info("agent ready", {
    totalMs: Math.round(performance.now() - bootStarted),
  })

  teardown = (code: number): void => {
    if (shuttingDown) return
    shuttingDown = true
    try {
      void chatSessions.dispose()
    } catch {
      // ignore
    }
    try {
      clearPiRuntimeCache()
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
