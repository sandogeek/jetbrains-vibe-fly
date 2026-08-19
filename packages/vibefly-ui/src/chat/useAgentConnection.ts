import type {SimpleRpcPeer} from "@sandogeek/simple-rpc"
import {
  type ChatEventBatch,
  type RecentChatSession,
  type Ui2Agent,
  settingKeys,
} from "@vibefly/uiagent-shared"
import {useCallback, useEffect, useRef, useState, type MutableRefObject} from "react"

import {applyUiLocale, i18n} from "../i18n"
import type {Ui2Host, Ui2HostChat} from "../generated/rpc"
import {log} from "../log"
import {type AgentStatus, connectAgentRpc} from "../rpc/agent"
import {createChatUiRpc} from "../rpc/client"
import {bindConsoleToHost} from "../rpc/console"
import {UiSettingsRuntime} from "../settings/UiSettingsRuntime"
import {SettingKeyStore} from "../settings/settingKeyStore"
import {useSettingKey} from "../settings/useSettingKey"
import type {ModelPreferences} from "../settings/settingsStore"
import {applyJbTheme} from "../theme"
import {createDemoTab} from "./demoSession"
import type {ChatTab, PendingInput, PendingPermission} from "./types"

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type AgentConnectionRefs = {
  hostRef: MutableRefObject<Ui2Host | null>
  hostChatRef: MutableRefObject<Ui2HostChat | null>
  agentRef: MutableRefObject<Ui2Agent | null>
  projectRootRef: MutableRefObject<string>
  offlineRef: MutableRefObject<boolean>
  settingsRuntimeRef: MutableRefObject<UiSettingsRuntime | null>
}

export function useAgentConnection(
  refs: AgentConnectionRefs,
  options: {
    applyBatch: (batch: ChatEventBatch) => void
    appendContexts: (
      sessionId: string,
      incoming: Array<{
        id: string
        kind: "selection" | "file"
        path: string
        text?: string
        startLine?: number
        endLine?: number
      }>,
    ) => void
    updatePendingPermission: (value: PendingPermission | null) => void
    updatePendingInput: (value: PendingInput | null) => void
    setInputReply: (value: string) => void
    updateTabs: (tabs: ChatTab[] | ((current: ChatTab[]) => ChatTab[])) => void
    updateActiveId: (sessionId: string) => void
    loadModels: (sessionId: string, force?: boolean) => Promise<void>
    persistWorkspace: () => Promise<void>
    cancelAllPending: () => void
    onModelPreferences: (preferences: ModelPreferences) => void
    setRecent: (sessions: RecentChatSession[]) => void
  },
) {
  const {
    applyBatch,
    appendContexts,
    updatePendingPermission,
    updatePendingInput,
    setInputReply,
    updateTabs,
    updateActiveId,
    loadModels,
    persistWorkspace,
    cancelAllPending,
    onModelPreferences,
    setRecent,
  } = options
  const {
    hostRef,
    hostChatRef,
    agentRef,
    projectRootRef,
    offlineRef,
    settingsRuntimeRef,
  } = refs

  const [hostStatus, setHostStatus] = useState("connecting")
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [settingsRuntime, setSettingsRuntime] = useState<UiSettingsRuntime | null>(null)
  const settingStore = settingsRuntime?.store ?? null
  const pinnedModelSpecs = useSettingKey(settingStore, settingKeys.modelPreferences.pinnedModelSpecs)
  const recentModelSpecs = useSettingKey(settingStore, settingKeys.modelPreferences.recentModelSpecs)
  const locale = useSettingKey(settingStore, settingKeys.ui.locale)

  const peerRef = useRef<SimpleRpcPeer | null>(null)
  const stopAgentRef = useRef<(() => void) | null>(null)
  const unbindConsoleRef = useRef<(() => void) | null>(null)

  const updateOffline = useCallback(
    (value: boolean) => {
      offlineRef.current = value
      setOffline(value)
    },
    [offlineRef],
  )

    const loadModelPreferences = useCallback(
      async () => {
        try {
          let runtime = settingsRuntimeRef.current
          if (!runtime) {
            runtime = new UiSettingsRuntime(new SettingKeyStore(() => agentRef.current))
            settingsRuntimeRef.current = runtime
            setSettingsRuntime(runtime)
          }
          await runtime.start()
        } catch (preferencesError) {
          log.warn("model preferences unavailable", preferencesError)
        }
      },
      [agentRef, settingsRuntimeRef],
    )

  useEffect(() => {
    onModelPreferences({pinnedModelSpecs, recentModelSpecs})
    applyUiLocale(locale)
  }, [onModelPreferences, pinnedModelSpecs, recentModelSpecs, locale])

  const bootstrap = useCallback(
    async (ui2Host: Ui2Host, ui2HostChat: Ui2HostChat, isDisposed: () => boolean) => {
      try {
        await ui2Host.getAppVersion()
        await ui2HostChat.chatUiReady()
        projectRootRef.current = await ui2HostChat.getProjectRoot()
        const [workspace] = await Promise.all([
          ui2HostChat.getChatWorkspaceState(),
          loadModelPreferences(),
        ])
        if (isDisposed()) return
        setHostStatus("connected")

        const connection = connectAgentRpc({
          ui2HostChat,
          isStopped: isDisposed,
          onReady(proxy) {
            agentRef.current = proxy
            if (proxy) {
              void settingsRuntimeRef.current?.start().catch((preferencesError) => {
                log.warn("model preferences unavailable", preferencesError)
              })
            }
          },
          onStatus(status) {
            setAgentStatus(status)
          },
          onChatEvents(batch) {
            applyBatch(batch)
          },
          requestToolPermission(request) {
            return new Promise((resolve) => {
              updatePendingPermission({request, resolve})
            })
          },
          requestUserInput(request) {
            return new Promise((resolve) => {
              setInputReply("")
              updatePendingInput({request, resolve})
            })
          },
          onSettingsInvalidated(change) {
            void settingsRuntimeRef.current?.notifyInvalidation(change)
          },
        })
        stopAgentRef.current = connection.stop

        const deadline = Date.now() + 30_000
        while (!agentRef.current && Date.now() < deadline && !isDisposed()) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        if (!agentRef.current) throw new Error(i18n.t("chat:agentTimeout"))

        const restored: ChatTab[] = []
        for (const sessionId of workspace.sessionIds ?? []) {
          try {
            restored.push(
              await agentRef.current.openChatSession({
                projectRoot: projectRootRef.current,
                sessionId,
              }),
            )
          } catch (restoreError) {
            log.warn("chat session restore failed", sessionId, restoreError)
          }
        }
        if (restored.length === 0) {
          const recentSessions = await agentRef.current.listRecentChatSessions({
            projectRoot: projectRootRef.current,
          })
          setRecent(recentSessions)
          for (const recentSession of recentSessions) {
            try {
              restored.push(
                await agentRef.current.openChatSession({
                  projectRoot: projectRootRef.current,
                  sessionId: recentSession.sessionId,
                  sessionFile: recentSession.sessionFile,
                }),
              )
              break
            } catch (restoreError) {
              log.warn(
                "recent chat session restore failed",
                recentSession.sessionId,
                restoreError,
              )
            }
          }
          if (restored.length === 0) {
            restored.push(
              await agentRef.current.createChatSession({
                projectRoot: projectRootRef.current,
              }),
            )
          }
        }
        if (isDisposed()) return
        updateTabs(restored)
        const savedActiveId = workspace.activeSessionId ?? ""
        const restoredActive = restored.some((tab) => tab.summary.sessionId === savedActiveId)
          ? savedActiveId
          : restored[0]!.summary.sessionId
        updateActiveId(restoredActive)
        await loadModels(restoredActive)
        void persistWorkspace()
      } catch (bootstrapError) {
        if (isDisposed()) return
        const message = errorText(bootstrapError)
        log.error("chat bootstrap failed", message)
        setError(message)
        setHostStatus("error")
      }
    },
    [
      agentRef,
      applyBatch,
      loadModelPreferences,
      loadModels,
      persistWorkspace,
      projectRootRef,
      setInputReply,
      setRecent,
      updateActiveId,
      updatePendingInput,
      updatePendingPermission,
      updateTabs,
    ],
  )

  useEffect(() => {
    let disposed = false
    const rpc = createChatUiRpc({
      host2Ui: {
        setStatus(message) {
          setHostStatus(message)
        },
        async setTheme(mode) {
          applyJbTheme(mode)
        },
      },
      host2UiChat: {
        async addChatContexts(sessionId, incoming) {
          appendContexts(
            sessionId,
            incoming.map((item) => ({
              id: item.id,
              kind: item.kind === "selection" ? "selection" : "file",
              path: item.path,
              text: item.text ?? undefined,
              startLine: item.startLine ?? undefined,
              endLine: item.endLine ?? undefined,
            })),
          )
        },
      },
    })

    if (!rpc) {
      updateOffline(true)
      setHostStatus("browser preview")
      setAgentStatus("unavailable")
      const demo = createDemoTab()
      updateTabs([demo])
      updateActiveId(demo.summary.sessionId)
    } else {
      hostRef.current = rpc.ui2Host
      hostChatRef.current = rpc.ui2HostChat
      peerRef.current = rpc.peer
      unbindConsoleRef.current = bindConsoleToHost(rpc.ui2Host)
      const runtime = new UiSettingsRuntime(new SettingKeyStore(() => agentRef.current))
      settingsRuntimeRef.current = runtime
      setSettingsRuntime(runtime)
      void bootstrap(rpc.ui2Host, rpc.ui2HostChat, () => disposed)
    }

    return () => {
      disposed = true
      stopAgentRef.current?.()
      stopAgentRef.current = null
      unbindConsoleRef.current?.()
      unbindConsoleRef.current = null
      settingsRuntimeRef.current = null
      setSettingsRuntime(null)
      peerRef.current?.close()
      peerRef.current = null
      hostRef.current = null
      hostChatRef.current = null
      agentRef.current = null
      cancelAllPending()
    }
  }, [
    agentRef,
    appendContexts,
    bootstrap,
    cancelAllPending,
    hostChatRef,
    hostRef,
    settingsRuntimeRef,
    updateActiveId,
    updateOffline,
    updateTabs,
  ])

  return {
    hostStatus,
    agentStatus,
    error,
    setError,
    offline,
    connected: agentStatus === "ready",
  }
}
