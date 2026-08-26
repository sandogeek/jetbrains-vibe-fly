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
import {applyAgentDirFromEnv, clearPiRuntimeCache, getPiRuntime, type PiRuntime} from "./piRuntime.js"
import {applyProviderConfigDocumentsPatch, getProvidersSnapshot, mutateCustomProviderDocumentsPatch} from "./providerConfig.js"
import {cancelActiveLogin, getLoginProviders, loginProvider, logoutProvider,} from "./providerLogin.js"
import {setProviderApiKey} from "./providerCredentials.js"
import {createAgentWsServer, createTicketStore, isValidOrigin,} from "./ws.js"
import {HostSettingsRuntime} from "./hostSettings.js"
import {AgentSettingsFacade} from "./settingsFacade.js"

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

  // Warm pi in parallel with WS + Host2Agent registration. Host currently
  // treats process spawn as READY and may call openWebSocketSession before
  // this function finishes — "Unknown method Host2Agent#1" if we wait.
  const piWarmStarted = performance.now()
  const piRuntimeReady: Promise<PiRuntime> = (async () => {
    const runtime = await getPiRuntime({
      agentDir,
      credentials: hostSettings.credentials,
      forceNew: true,
    })
    await hostSettings.attachModelRuntime(runtime.modelRuntime)
    log.info("host-backed pi runtime ready", {
      elapsedMs: Math.round(performance.now() - piWarmStarted),
    })
    return runtime
  })()

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
  const settingsFacade = new AgentSettingsFacade(hostSettings)

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
    settingsChanged(notification) {
      return settingsFacade.notifyFromHost(notification)
    },
    getProvidersSnapshot(modelsJson: string, authJson: string) {
      return getProvidersSnapshot(modelsJson, authJson)
    },
    applyProvidersPatch(request, modelsJson: string) {
      return applyProviderConfigDocumentsPatch(request, modelsJson)
    },
    async getLoginProviders() {
      return getLoginProviders(await piRuntimeReady)
    },
    async loginProvider(request) {
      return loginProvider(request, agent2Host, await piRuntimeReady)
    },
    async logoutProvider(request) {
      return logoutProvider(request, await piRuntimeReady)
    },
    cancelProviderLogin() {
      cancelActiveLogin()
    },
    async setProviderApiKey(request) {
      return setProviderApiKey(request, await piRuntimeReady)
    },
    mutateCustomProvider(request, modelsJson: string, authJson: string) {
      return mutateCustomProviderDocumentsPatch(request, modelsJson, authJson)
    },
  }
  wsServer.setSessionFactory((wsPeer) => {
    const agent2Ui: Agent2Ui = createAgent2UiProxy(wsPeer)
    const unlistenSettings = settingsFacade.hub.add(agent2Ui)
    let chatBound = false
    const bindChat = () => {
      if (chatBound) return
      chatBound = true
      chatSessions.attach(agent2Ui)
    }
    const ui2AgentImpl: Ui2AgentService = {
      ping(text: string) {
        return `pong:${text}`
      },
      listChatSessions(request) {
        bindChat()
        return chatSessions.listChatSessions(request)
      },
      listRecentChatSessions(request) {
        bindChat()
        return chatSessions.listRecentChatSessions(request)
      },
      openChatSession(request) {
        bindChat()
        return chatSessions.openChatSession(request)
      },
      createChatSession(request) {
        bindChat()
        return chatSessions.createChatSession(request)
      },
      releaseChatSession(sessionId) {
        bindChat()
        return chatSessions.releaseChatSession(sessionId)
      },
      sendChatMessage(request) {
        bindChat()
        return chatSessions.sendChatMessage(request)
      },
      retryChatTurn(sessionId) {
        bindChat()
        return chatSessions.retryChatTurn(sessionId)
      },
      cancelQueuedTurn(sessionId) {
        bindChat()
        chatSessions.cancelQueuedTurn(sessionId)
      },
      abortChatTurn(sessionId) {
        bindChat()
        return chatSessions.abortChatTurn(sessionId)
      },
      listChatModels(sessionId) {
        bindChat()
        return chatSessions.listChatModels(sessionId)
      },
      setChatModel(sessionId, modelId) {
        bindChat()
        return chatSessions.setChatModel(sessionId, modelId)
      },
      setChatThinkingLevel(sessionId, level) {
        bindChat()
        return chatSessions.setChatThinkingLevel(sessionId, level)
      },
      markChatSessionRead(sessionId) {
        bindChat()
        chatSessions.markChatSessionRead(sessionId)
      },
      readSettingValues(keyIds) {
        return settingsFacade.readSettingValues(keyIds)
      },
      mutateSettings(request) {
        return settingsFacade.mutateSettings(request)
      },
    }
    registerUi2AgentService(wsPeer, ui2AgentImpl)
    return () => {
      unlistenSettings()
      if (chatBound) chatSessions.detach(agent2Ui)
    }
  })

  registerHost2AgentService(peer, controlImpl)
  // Settings can change after the initial snapshot but before Host2Agent is
  // registered. Re-read both scopes once the control service can no longer
  // miss invalidations; subsequent notifications are serialized normally.
  await hostSettings.refreshFromHost()

  await piRuntimeReady
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
