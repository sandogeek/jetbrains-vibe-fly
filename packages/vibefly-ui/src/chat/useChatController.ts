import type {
  ChatContextItem,
  ChatEventBatch,
  RecentChatSession,
  ToolPermissionDecision,
  Ui2Agent,
} from "@vibefly/uiagent-shared"
import {useCallback, useRef} from "react"

import type {Ui2Host, Ui2HostChat} from "../generated/rpc"
import {log} from "../log"
import type {AgentStatus} from "../rpc/agent"
import {modelPreferenceMutations} from "../settings/hostSettings"
import type {ModelPickerOption} from "../settings/ModelPicker"
import type {ModelPreferences} from "../settings/settingsStore"
import {UiSettingsRuntime} from "../settings/UiSettingsRuntime"
import {applyChatEvent} from "./chatEventState"
import type {ChatTab, PendingInput, PendingPermission, ThinkingOption} from "./types"
import {useAgentConnection} from "./useAgentConnection"
import {useChatTabs} from "./useChatTabs"
import {useChatWorkspace} from "./useChatWorkspace"
import {usePermissionFlow} from "./usePermissionFlow"

export type ChatController = {
  hostStatus: string
  agentStatus: AgentStatus
  tabs: ChatTab[]
  activeId: string
  activeTab: ChatTab | null
  recent: RecentChatSession[]
  recentOpen: boolean
  offline: boolean
  error: string | null
  activeDraft: string
  activeContexts: ChatContextItem[]
  activeModelOptions: ModelPickerOption[]
  modelPreferences: ModelPreferences
  thinkingOptions: ThinkingOption[]
  busy: boolean
  queued: boolean
  connected: boolean
  pendingPermission: PendingPermission | null
  pendingInput: PendingInput | null
  inputReply: string
  actions: {
    activate: (sessionId: string) => Promise<void>
    newSession: () => Promise<void>
    closeSession: (sessionId: string) => Promise<void>
    closeOtherSessions: (sessionId: string) => Promise<void>
    refreshRecent: () => Promise<void>
    closeRecent: () => void
    openRecent: (session: RecentChatSession) => Promise<void>
    reorderTabs: (draggedId: string, targetId: string) => void
    setDraft: (sessionId: string, value: string) => void
    sendMessage: (sessionId: string, text: string) => Promise<void>
    stopOrCancel: (sessionId?: string) => Promise<void>
    chooseContextFiles: () => Promise<void>
    removeContext: (sessionId: string, contextId: string) => void
    onChatModelChange: (spec: string, pinned: string[], recentModels: string[]) => void
    setThinking: (level: string) => Promise<void>
    respondPermission: (decision: ToolPermissionDecision) => void
    respondInput: (cancelInput?: boolean) => void
    setInputReply: (value: string) => void
    dismissError: () => void
    openSettings: () => void
    openLocation: (path: string, line?: number) => void
    showDiff: (path: string) => void
    openExternalUrl: (url: string) => void
  }
}

export function useChatController(): ChatController {
  const hostRef = useRef<Ui2Host | null>(null)
  const hostChatRef = useRef<Ui2HostChat | null>(null)
  const agentRef = useRef<Ui2Agent | null>(null)
  const projectRootRef = useRef("")
  const offlineRef = useRef(false)
  const settingsRuntimeRef = useRef<UiSettingsRuntime | null>(null)
  const errorSetterRef = useRef<(error: string | null) => void>(() => {})
  const workspaceLoadModelsRef = useRef<(sessionId: string, force?: boolean) => Promise<void>>(
    async () => {},
  )
  const workspacePersistRef = useRef<() => Promise<void>>(async () => {})
  const updateTabsRef = useRef<(update: ChatTab[] | ((current: ChatTab[]) => ChatTab[])) => void>(
    () => {},
  )

  const permission = usePermissionFlow()

  const setError = useCallback((error: string | null) => {
    errorSetterRef.current(error)
  }, [])

  const loadModelsStable = useCallback(
    (sessionId: string, force?: boolean) => workspaceLoadModelsRef.current(sessionId, force),
    [],
  )
  const persistWorkspaceStable = useCallback(() => workspacePersistRef.current(), [])

  const tabs = useChatTabs({
    agentRef,
    offlineRef,
    projectRootRef,
    persistWorkspace: persistWorkspaceStable,
    loadModels: loadModelsStable,
    setError,
  })

  updateTabsRef.current = tabs.updateTabs
  const tabsRef = tabs.tabsRef
  const activeIdRef = tabs.activeIdRef

  const workspace = useChatWorkspace({
    activeId: tabs.activeId,
    agentRef,
    offlineRef,
    hostChatRef,
    hostRef,
    tabsRef,
    activeIdRef,
    setError,
  })

  workspaceLoadModelsRef.current = workspace.loadModels
  workspacePersistRef.current = workspace.persistWorkspace

  const applyBatch = useCallback(
    (batch: ChatEventBatch) => {
      for (const event of batch.events) {
        if (event.kind === "modelCatalogChanged") {
          void workspaceLoadModelsRef.current(event.sessionId, true)
          continue
        }
        const result = applyChatEvent(tabsRef.current, event, activeIdRef.current)
        updateTabsRef.current(result.tabs)
        if (result.effects.refreshPaths.length > 0) {
          void hostChatRef.current?.refreshProjectFiles(result.effects.refreshPaths).catch(() => {})
        }
        if (result.effects.error) setError(result.effects.error)
      }
    },
    [activeIdRef, setError, tabsRef],
  )

  const connection = useAgentConnection(
    {
      hostRef,
      hostChatRef,
      agentRef,
      projectRootRef,
      offlineRef,
      settingsRuntimeRef,
    },
    {
      applyBatch,
      appendContexts: workspace.appendContexts,
      updatePendingPermission: permission.updatePendingPermission,
      updatePendingInput: permission.updatePendingInput,
      setInputReply: permission.setInputReply,
      updateTabs: tabs.updateTabs,
      updateActiveId: tabs.updateActiveId,
      loadModels: loadModelsStable,
      persistWorkspace: persistWorkspaceStable,
      cancelAllPending: permission.cancelAllPending,
      onModelPreferences: workspace.setModelPreferences,
      setRecent: tabs.setRecent,
    },
  )

  errorSetterRef.current = connection.setError

  const persistModelPreferences = (preferences: ModelPreferences) => {
    const runtime = settingsRuntimeRef.current
    if (!runtime || offlineRef.current) return
    void runtime.mutate(modelPreferenceMutations(preferences)).catch((preferencesError) => {
      log.warn("model preferences save failed", preferencesError)
      connection.setError(
        preferencesError instanceof Error ? preferencesError.message : String(preferencesError),
      )
    })
  }

  const onChatModelChange = (spec: string, pinned: string[], recentModels: string[]) => {
    const preferences = {
      pinnedModelSpecs: [...pinned],
      recentModelSpecs: [...recentModels],
    }
    workspace.setModelPreferences(preferences)
    persistModelPreferences(preferences)
    if (spec && spec !== tabs.activeTab?.summary.modelId) void workspace.setModel(spec)
  }

  const sendMessage = async (sessionId: string, text: string) => {
    const trimmed = text.trim()
    const tab = tabsRef.current.find((item) => item.summary.sessionId === sessionId)
    if (!sessionId || !trimmed || !tab) return
    if (["running", "waiting_permission", "waiting_input", "queued"].includes(tab.summary.state)) {
      return
    }
    if (!offlineRef.current && !agentRef.current) return
    workspace.setDraft(sessionId, "")
    if (offlineRef.current) {
      tabs.updateTabs((current) =>
        current.map((item) =>
          item.summary.sessionId === sessionId
            ? {
                ...item,
                messages: [
                  ...item.messages,
                  {
                    id: `local-${Date.now()}`,
                    role: "user",
                    parts: [{kind: "text", text: trimmed}],
                    createdAt: Date.now(),
                    status: "complete",
                  },
                ],
              }
            : item,
        ),
      )
      return
    }
    if (!agentRef.current) return
    connection.setError(null)
    try {
      await agentRef.current.sendChatMessage({
        sessionId,
        text: trimmed,
        contexts: workspace.contextsRef.current[sessionId] ?? [],
        clientMessageId: crypto.randomUUID(),
      })
      workspace.updateContexts((current) => ({...current, [sessionId]: []}))
    } catch (sendError) {
      workspace.setDraft(sessionId, text)
      connection.setError(sendError instanceof Error ? sendError.message : String(sendError))
    }
  }

  return {
    hostStatus: connection.hostStatus,
    agentStatus: connection.agentStatus,
    tabs: tabs.tabs,
    activeId: tabs.activeId,
    activeTab: tabs.activeTab,
    recent: tabs.recent,
    recentOpen: tabs.recentOpen,
    offline: connection.offline,
    error: connection.error,
    activeDraft: workspace.activeDraft,
    activeContexts: workspace.activeContexts,
    activeModelOptions: workspace.activeModelOptions,
    modelPreferences: workspace.modelPreferences,
    thinkingOptions: tabs.thinkingOptions,
    busy: tabs.busy,
    queued: tabs.queued,
    connected: connection.connected,
    pendingPermission: permission.pendingPermission,
    pendingInput: permission.pendingInput,
    inputReply: permission.inputReply,
    actions: {
      activate: tabs.activate,
      newSession: tabs.newSession,
      closeSession: tabs.closeSession,
      closeOtherSessions: tabs.closeOtherSessions,
      refreshRecent: tabs.refreshRecent,
      closeRecent: tabs.closeRecent,
      openRecent: tabs.openRecent,
      reorderTabs: tabs.reorderTabs,
      setDraft: workspace.setDraft,
      sendMessage,
      stopOrCancel: workspace.stopOrCancel,
      chooseContextFiles: workspace.chooseContextFiles,
      removeContext: workspace.removeContext,
      onChatModelChange,
      setThinking: workspace.setThinking,
      respondPermission: permission.respondPermission,
      respondInput: permission.respondInput,
      setInputReply: permission.setInputReply,
      dismissError: () => connection.setError(null),
      openSettings: () => void hostChatRef.current?.openIdeSettings(),
      openLocation: workspace.openLocation,
      showDiff: workspace.showDiff,
      openExternalUrl: workspace.openExternalUrl,
    },
  }
}
