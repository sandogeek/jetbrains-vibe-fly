import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type AppendMessage,
  type DataMessagePartProps,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react"
import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown"
import type { SimpleRpcPeer } from "@sandogeek/simple-rpc"
import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import type {
  ChatContextItem,
  ChatEvent,
  ChatEventBatch,
  ChatMessage,
  ChatModelOption,
  ChatPart,
  ChatSessionSnapshot,
  ChatSessionSummary,
  RecentChatSession,
  ToolPermissionDecision,
  ToolPermissionRequest,
  ToolPermissionResponse,
  Ui2Agent,
  UserInputRequest,
  UserInputResponse,
} from "@vibefly/uiagent-shared"
import {
  AlertTriangle,
  Bot,
  Brain,
  Check,
  ChevronDown,
  CircleStop,
  Clock3,
  FileCode2,
  GitCompareArrows,
  History,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react"

import remarkBreaks from "remark-breaks"
import { applyUiLocale, i18n, useAppTranslation } from "./i18n"
import { convertChatMessage, type ToolArtifact } from "./chatMessageAdapter"
import type { ModelPreferencesDto, Ui2Host } from "./generated/rpc"
import { log } from "./log"
import { connectAgentRpc, type AgentStatus } from "./rpc/agent"
import { createUiRpc } from "./rpc/client"
import { bindConsoleToHost } from "./rpc/console"
import { ModelPicker, type ModelPickerOption } from "./settings/ModelPicker"
import { applyJbTheme } from "./theme"

type ChatTab = ChatSessionSnapshot

type PendingPermission = {
  request: ToolPermissionRequest
  resolve: (response: ToolPermissionResponse) => void
}

type PendingInput = {
  request: UserInputRequest
  resolve: (response: UserInputResponse) => void
}

type ThinkingOption = {
  value: string
  label: string
}

const MAX_OPEN_TABS = 8

function modelLabel(modelId: string | undefined, fallback: string): string {
  if (!modelId) return fallback
  const slash = modelId.indexOf("/")
  return slash >= 0 ? modelId.slice(slash + 1) : modelId
}

function demoTab(): ChatTab {
  const timestamp = Date.now()
  return {
    summary: {
      sessionId: "demo-session",
      title: "GenerateCommitMessageAction 取消时远端未取消",
      state: "completed",
      unread: false,
      modelId: "local-grok/grok-4.5",
      thinkingLevel: "high",
      updatedAt: timestamp,
      messageCount: 3,
    },
    messages: [
      {
        id: "demo-user",
        role: "user",
        status: "complete",
        createdAt: timestamp - 80_000,
        parts: [
          {
            kind: "text",
            text: "取消生成提交信息时，远端 RPC 仍在继续。请补充 host 和 agent 两侧的取消日志，并确保 AbortError 能正确结束流。",
          },
        ],
      },
      {
        id: "demo-assistant",
        role: "assistant",
        status: "complete",
        createdAt: timestamp - 60_000,
        parts: [
          {
            kind: "thinking",
            text: "The companion object reference is a bit awkward. I will keep one logger for the action and add a package logger for the cancellation helper. Then I will cover the stream abort path.",
          },
          {
            kind: "text",
            text: "Cleaning up the cancellation path and the duplicate logger setup.",
          },
          {
            kind: "tool",
            toolCallId: "demo-tool-1",
            name: "edit",
            status: "completed",
            input: { path: "plugin/src/main/kotlin/.../GenerateCommitMessageAction.kt" },
            output: "+8  -2",
            locations: [
              {
                path: "plugin/src/main/kotlin/com/github/sandogeek/jetbrainsvibefly/commit/GenerateCommitMessageAction.kt",
              },
            ],
          },
          {
            kind: "tool",
            toolCallId: "demo-tool-2",
            name: "edit",
            status: "completed",
            input: { path: "packages/vibefly-agent/src/commitMessage.ts" },
            output: "+5  -1",
            locations: [{ path: "packages/vibefly-agent/src/commitMessage.ts" }],
          },
          {
            kind: "thinking",
            text: "The main remote-cancel path also needs an abort listener before the stream begins, otherwise cancellation can arrive before the loop observes the signal.",
          },
          {
            kind: "text",
            text: "The host now records cancellation before propagating it, and the Agent records both the abort receipt and the final aborted stream. The active request is released as soon as cancellation arrives.",
          },
        ],
      },
    ],
  }
}

export function App() {
  const { t } = useAppTranslation("chat")
  const [hostStatus, setHostStatus] = useState("connecting")
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle")
  const [tabs, setTabs] = useState<ChatTab[]>([])
  const [activeId, setActiveId] = useState("")
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [contexts, setContexts] = useState<Record<string, ChatContextItem[]>>({})
  const [models, setModels] = useState<Record<string, ChatModelOption[]>>({})
  const [modelPreferences, setModelPreferences] = useState<ModelPreferencesDto>({
    recentModelSpecs: [],
    pinnedModelSpecs: [],
  })
  const [recent, setRecent] = useState<RecentChatSession[]>([])
  const [recentOpen, setRecentOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null)
  const [pendingInput, setPendingInput] = useState<PendingInput | null>(null)
  const [inputReply, setInputReply] = useState("")
  const [offline, setOffline] = useState(false)

  const hostRef = useRef<Ui2Host | null>(null)
  const agentRef = useRef<Ui2Agent | null>(null)
  const projectRootRef = useRef("")
  const peerRef = useRef<SimpleRpcPeer | null>(null)
  const stopAgentRef = useRef<(() => void) | null>(null)
  const unbindConsoleRef = useRef<(() => void) | null>(null)
  const modelPreferencesSaveRef = useRef(Promise.resolve())
  const dragSessionIdRef = useRef<string | null>(null)
  const tabsRef = useRef<ChatTab[]>([])
  const activeIdRef = useRef("")
  const contextsRef = useRef<Record<string, ChatContextItem[]>>({})
  const modelsRef = useRef<Record<string, ChatModelOption[]>>({})
  const offlineRef = useRef(false)
  const pendingPermissionRef = useRef<PendingPermission | null>(null)
  const pendingInputRef = useRef<PendingInput | null>(null)

  const updateTabs = useCallback((update: ChatTab[] | ((current: ChatTab[]) => ChatTab[])) => {
    const next = typeof update === "function" ? update(tabsRef.current) : update
    tabsRef.current = next
    setTabs(next)
  }, [])

  const updateActiveId = useCallback((sessionId: string) => {
    activeIdRef.current = sessionId
    setActiveId(sessionId)
  }, [])

  const updateContexts = useCallback(
    (
      update:
        | Record<string, ChatContextItem[]>
        | ((current: Record<string, ChatContextItem[]>) => Record<string, ChatContextItem[]>),
    ) => {
      const next = typeof update === "function" ? update(contextsRef.current) : update
      contextsRef.current = next
      setContexts(next)
    },
    [],
  )

  const updateModels = useCallback(
    (
      update:
        | Record<string, ChatModelOption[]>
        | ((current: Record<string, ChatModelOption[]>) => Record<string, ChatModelOption[]>),
    ) => {
      const next = typeof update === "function" ? update(modelsRef.current) : update
      modelsRef.current = next
      setModels(next)
    },
    [],
  )

  const updateOffline = useCallback((value: boolean) => {
    offlineRef.current = value
    setOffline(value)
  }, [])

  const updatePendingPermission = useCallback((value: PendingPermission | null) => {
    pendingPermissionRef.current = value
    setPendingPermission(value)
  }, [])

  const updatePendingInput = useCallback((value: PendingInput | null) => {
    pendingInputRef.current = value
    setPendingInput(value)
  }, [])

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.summary.sessionId === activeId) ?? null,
    [activeId, tabs],
  )
  const activeContexts = contexts[activeId] ?? []
  const activeDraft = drafts[activeId] ?? ""
  const activeModelOptions = useMemo<ModelPickerOption[]>(
    () =>
      (models[activeId] ?? []).map((option) => ({
        spec: option.id,
        providerId: option.provider,
        modelId: option.model,
        modelLabel: option.label,
        reasoning: option.supportsThinking,
      })),
    [activeId, models],
  )
  const thinkingOptions = useMemo<ThinkingOption[]>(
    () => [
      { value: "off", label: t("chat:thinkingOff") },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "XHigh" },
      { value: "auto", label: "Auto" },
    ],
    [t],
  )
  const isBusy = ["running", "waiting_permission", "waiting_input"].includes(
    activeTab?.summary.state ?? "",
  )
  const isQueued = activeTab?.summary.state === "queued"

  const appendContexts = useCallback(
    (sessionId: string, incoming: ChatContextItem[]) => {
      if (!sessionId || incoming.length === 0) return
      updateContexts((current) => {
        const existing = current[sessionId] ?? []
        const keys = new Set(
          existing.map(
            (item) => `${item.kind}:${item.path}:${item.startLine ?? ""}:${item.endLine ?? ""}`,
          ),
        )
        const added = incoming.filter((item) => {
          const key = `${item.kind}:${item.path}:${item.startLine ?? ""}:${item.endLine ?? ""}`
          if (!item.path || keys.has(key)) return false
          keys.add(key)
          return true
        })
        return { ...current, [sessionId]: [...existing, ...added] }
      })
    },
    [updateContexts],
  )

  const updateMessages = useCallback(
    (sessionId: string, update: (messages: ChatMessage[]) => ChatMessage[]) => {
      updateTabs((current) =>
        current.map((tab) =>
          tab.summary.sessionId === sessionId
            ? { ...tab, messages: update(tab.messages) }
            : tab,
        ),
      )
    },
    [updateTabs],
  )

  const updateMessage = useCallback(
    (sessionId: string, messageId: string, update: (message: ChatMessage) => ChatMessage) => {
      updateMessages(sessionId, (messages) => {
        const exists = messages.some((message) => message.id === messageId)
        const source = exists
          ? messages
          : [
              ...messages,
              {
                id: messageId,
                role: "assistant" as const,
                parts: [],
                createdAt: Date.now(),
                status: "streaming" as const,
              },
            ]
        return source.map((message) => (message.id === messageId ? update(message) : message))
      })
    },
    [updateMessages],
  )

  const applyEvent = useCallback(
    (event: ChatEvent) => {
      if (event.kind === "snapshot") {
        updateTabs((current) => {
          const index = current.findIndex(
            (tab) => tab.summary.sessionId === event.snapshot.summary.sessionId,
          )
          if (index < 0) return [...current, event.snapshot]
          return current.map((tab, tabIndex) => (tabIndex === index ? event.snapshot : tab))
        })
        return
      }
      if (event.kind === "summary") {
        updateTabs((current) =>
          current.map((tab) =>
            tab.summary.sessionId === event.summary.sessionId
              ? {
                  ...tab,
                  summary: {
                    ...tab.summary,
                    ...event.summary,
                    unread:
                      event.summary.sessionId === activeIdRef.current
                        ? false
                        : event.summary.unread,
                  },
                }
              : tab,
          ),
        )
        return
      }
      if (event.kind === "message") {
        updateMessages(event.sessionId, (messages) => {
          const duplicate = messages.some((message) => message.id === event.message.id)
          if (duplicate) {
            return messages.map((message) =>
              message.id === event.message.id ? event.message : message,
            )
          }
          return [...messages, event.message]
        })
        return
      }
      if (event.kind === "partDelta") {
        updateMessage(event.sessionId, event.messageId, (message) => {
          const index = message.parts.findIndex((part) => part.kind === event.partKind)
          if (index < 0) {
            return {
              ...message,
              parts: [...message.parts, { kind: event.partKind, text: event.delta }],
            }
          }
          const parts = [...message.parts]
          const part = parts[index] as Extract<ChatPart, { kind: "text" | "thinking" }>
          parts[index] = { ...part, text: part.text + event.delta }
          return { ...message, parts }
        })
        return
      }
      if (event.kind === "messageStatus") {
        updateMessage(event.sessionId, event.messageId, (message) => ({
          ...message,
          status: event.status,
        }))
        return
      }
      if (event.kind === "tool") {
        updateMessage(event.sessionId, event.messageId, (message) => {
          const index = message.parts.findIndex(
            (part) => part.kind === "tool" && part.toolCallId === event.part.toolCallId,
          )
          if (index < 0) return { ...message, parts: [...message.parts, event.part] }
          const parts = [...message.parts]
          parts[index] = {
            ...(parts[index] as Extract<ChatPart, { kind: "tool" }>),
            ...event.part,
          }
          return { ...message, parts }
        })
        if (
          event.part.status === "completed" &&
          (event.part.name === "edit" || event.part.name === "write") &&
          event.part.locations?.length
        ) {
          void hostRef.current
            ?.refreshProjectFiles(event.part.locations.map((location) => location.path))
            .catch(() => {})
        }
        return
      }
      if (event.kind === "turnComplete") {
        updateTabs((current) =>
          current.map((tab) =>
            tab.summary.sessionId === event.sessionId
              ? {
                  ...tab,
                  summary: {
                    ...tab.summary,
                    state: event.ok ? "completed" : event.aborted ? "idle" : "error",
                    unread: event.sessionId !== activeIdRef.current,
                  },
                }
              : tab,
          ),
        )
        if (event.error && !event.aborted) setError(event.error)
        return
      }
      if (event.kind === "sessionReleased") {
        updateTabs((current) =>
          current.filter((tab) => tab.summary.sessionId !== event.sessionId),
        )
        return
      }
      if (event.kind === "disconnected") setError(event.message)
    },
    [updateMessage, updateMessages, updateTabs],
  )

  const applyBatch = useCallback(
    (batch: ChatEventBatch) => {
      for (const event of batch.events) applyEvent(event)
    },
    [applyEvent],
  )

  const loadModelPreferences = useCallback(async (ui2Host: Ui2Host) => {
    try {
      const settings = await ui2Host.getIdeSettings()
      const preferences = settings.modelPreferences
      setModelPreferences({
        recentModelSpecs: [...(preferences?.recentModelSpecs ?? [])],
        pinnedModelSpecs: [...(preferences?.pinnedModelSpecs ?? [])],
      })
      applyUiLocale(settings.ui?.locale)
    } catch (preferencesError) {
      log.warn("model preferences unavailable", preferencesError)
    }
  }, [])

  const loadModels = useCallback(
    async (sessionId: string) => {
      const chatAgent = agentRef.current
      if (!chatAgent || modelsRef.current[sessionId]) return
      try {
        const options = await chatAgent.listChatModels(sessionId)
        updateModels((current) => ({ ...current, [sessionId]: options }))
      } catch (modelError) {
        log.debug("model list unavailable", modelError)
      }
    },
    [updateModels],
  )

  const persistWorkspace = useCallback(async () => {
    const chatHost = hostRef.current
    if (!chatHost || offlineRef.current) return
    try {
      await chatHost.saveChatWorkspaceState({
        sessionIds: tabsRef.current
          .map((tab) => tab.summary.sessionId)
          .slice(0, MAX_OPEN_TABS),
        activeSessionId: activeIdRef.current,
      })
    } catch (persistError) {
      log.debug("workspace state save failed", persistError)
    }
  }, [])

  const bootstrap = useCallback(
    async (ui2Host: Ui2Host, isDisposed: () => boolean) => {
      try {
        await ui2Host.getAppVersion()
        await ui2Host.chatUiReady()
        projectRootRef.current = await ui2Host.getProjectRoot()
        const [workspace] = await Promise.all([
          ui2Host.getChatWorkspaceState(),
          loadModelPreferences(ui2Host),
        ])
        if (isDisposed()) return
        setHostStatus("connected")

        const connection = connectAgentRpc({
          ui2Host,
          isStopped: isDisposed,
          onReady(proxy) {
            agentRef.current = proxy
          },
          onStatus(status) {
            setAgentStatus(status)
          },
          onChatEvents(batch) {
            applyBatch(batch)
          },
          requestToolPermission(request) {
            return new Promise((resolve) => {
              updatePendingPermission({ request, resolve })
            })
          },
          requestUserInput(request) {
            return new Promise((resolve) => {
              setInputReply("")
              updatePendingInput({ request, resolve })
            })
          },
        })
        stopAgentRef.current = connection.stop

        const deadline = Date.now() + 30_000
        while (!agentRef.current && Date.now() < deadline && !isDisposed()) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        if (!agentRef.current) throw new Error(i18n.t("chat:agentTimeout"))

        const restored: ChatTab[] = []
        for (const sessionId of (workspace.sessionIds ?? []).slice(0, MAX_OPEN_TABS)) {
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
        const restoredActive = restored.some(
          (tab) => tab.summary.sessionId === savedActiveId,
        )
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
      applyBatch,
      loadModelPreferences,
      loadModels,
      persistWorkspace,
      updateActiveId,
      updatePendingInput,
      updatePendingPermission,
      updateTabs,
    ],
  )

  useEffect(() => {
    let disposed = false
    const rpc = createUiRpc({
      setStatus(message) {
        setHostStatus(message)
      },
      async loginOpenUrl() {},
      async loginProgress() {},
      async requestLoginInput() {
        return { text: "", cancelled: true }
      },
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
      async setTheme(mode) {
        applyJbTheme(mode)
      },
    })

    if (!rpc) {
      updateOffline(true)
      setHostStatus("browser preview")
      setAgentStatus("unavailable")
      const demo = demoTab()
      updateTabs([demo])
      updateActiveId(demo.summary.sessionId)
    } else {
      hostRef.current = rpc.ui2Host
      peerRef.current = rpc.peer
      unbindConsoleRef.current = bindConsoleToHost(rpc.ui2Host)
      void bootstrap(rpc.ui2Host, () => disposed)
    }

    return () => {
      disposed = true
      stopAgentRef.current?.()
      stopAgentRef.current = null
      unbindConsoleRef.current?.()
      unbindConsoleRef.current = null
      peerRef.current?.close()
      peerRef.current = null
      agentRef.current = null
      const permission = pendingPermissionRef.current
      if (permission) {
        permission.resolve({ requestId: permission.request.requestId, decision: "cancelled" })
        updatePendingPermission(null)
      }
      const input = pendingInputRef.current
      if (input) {
        input.resolve({ requestId: input.request.requestId, cancelled: true })
        updatePendingInput(null)
      }
    }
  }, [
    appendContexts,
    bootstrap,
    updateActiveId,
    updateOffline,
    updatePendingInput,
    updatePendingPermission,
    updateTabs,
  ])

  const activate = async (sessionId: string) => {
    updateActiveId(sessionId)
    updateTabs((current) =>
      current.map((tab) =>
        tab.summary.sessionId === sessionId
          ? { ...tab, summary: { ...tab.summary, unread: false } }
          : tab,
      ),
    )
    await persistWorkspace()
    if (agentRef.current && !offlineRef.current) {
      void agentRef.current.markChatSessionRead(sessionId).catch(() => {})
      await loadModels(sessionId)
    }
  }

  const newSession = async () => {
    setRecentOpen(false)
    if (tabsRef.current.length >= MAX_OPEN_TABS) {
      setError(t("chat:maxSessions"))
      return
    }
    if (offlineRef.current) {
      const id = `demo-${Date.now()}`
      const tab: ChatTab = {
        summary: {
          sessionId: id,
          title: t("chat:newSession"),
          state: "idle",
          unread: false,
          updatedAt: Date.now(),
          messageCount: 0,
        },
        messages: [],
      }
      updateTabs((current) => [...current, tab])
      updateActiveId(id)
      return
    }
    if (!agentRef.current) return
    try {
      const snapshot = await agentRef.current.createChatSession({
        projectRoot: projectRootRef.current,
      })
      updateTabs((current) => [...current, snapshot])
      await activate(snapshot.summary.sessionId)
    } catch (createError) {
      setError(errorText(createError))
    }
  }

  const closeSession = async (sessionId: string, event: ReactMouseEvent) => {
    event.stopPropagation()
    const tab = tabsRef.current.find((item) => item.summary.sessionId === sessionId)
    if (!tab) return
    const running = ["running", "waiting_permission", "waiting_input"].includes(
      tab.summary.state,
    )
    if (running && !window.confirm(t("chat:closeRunning"))) return
    try {
      if (running && agentRef.current) await agentRef.current.abortChatTurn(sessionId)
      if (agentRef.current && !offlineRef.current) {
        await agentRef.current.releaseChatSession(sessionId)
      }
      let nextTabs = tabsRef.current.filter(
        (item) => item.summary.sessionId !== sessionId,
      )
      updateTabs(nextTabs)
      if (nextTabs.length === 0) {
        await newSession()
        nextTabs = tabsRef.current
      }
      if (activeIdRef.current === sessionId && nextTabs[0]) {
        await activate(nextTabs[0].summary.sessionId)
      }
      void persistWorkspace()
    } catch (closeError) {
      setError(errorText(closeError))
    }
  }

  const refreshRecent = async () => {
    const open = !recentOpen
    setRecentOpen(open)
    if (!open || !agentRef.current || offlineRef.current) return
    try {
      setRecent(
        await agentRef.current.listRecentChatSessions({
          projectRoot: projectRootRef.current,
        }),
      )
    } catch (recentError) {
      setError(errorText(recentError))
    }
  }

  const openRecent = async (session: RecentChatSession) => {
    setRecentOpen(false)
    const existing = tabsRef.current.find(
      (tab) => tab.summary.sessionId === session.sessionId,
    )
    if (existing) {
      await activate(existing.summary.sessionId)
      return
    }
    if (tabsRef.current.length >= MAX_OPEN_TABS || !agentRef.current) {
      setError(t("chat:closeSessionFirst"))
      return
    }
    try {
      const snapshot = await agentRef.current.openChatSession({
        projectRoot: projectRootRef.current,
        sessionId: session.sessionId,
        sessionFile: session.sessionFile,
      })
      updateTabs((current) => [...current, snapshot])
      await activate(snapshot.summary.sessionId)
    } catch (openError) {
      setError(errorText(openError))
    }
  }

  const sendMessage = async (sessionId: string, text: string) => {
    const trimmed = text.trim()
    const tab = tabsRef.current.find((item) => item.summary.sessionId === sessionId)
    if (!sessionId || !trimmed || !tab) return
    if (["running", "waiting_permission", "waiting_input", "queued"].includes(tab.summary.state)) {
      return
    }
    if (!offlineRef.current && !agentRef.current) return
    setDrafts((current) => ({ ...current, [sessionId]: "" }))
    if (offlineRef.current) {
      updateMessages(sessionId, (messages) => [
        ...messages,
        {
          id: `local-${Date.now()}`,
          role: "user",
          parts: [{ kind: "text", text: trimmed }],
          createdAt: Date.now(),
          status: "complete",
        },
      ])
      return
    }
    if (!agentRef.current) return
    setError(null)
    try {
      await agentRef.current.sendChatMessage({
        sessionId,
        text: trimmed,
        contexts: contextsRef.current[sessionId] ?? [],
        clientMessageId: crypto.randomUUID(),
      })
      updateContexts((current) => ({ ...current, [sessionId]: [] }))
    } catch (sendError) {
      setDrafts((current) => ({ ...current, [sessionId]: text }))
      setError(errorText(sendError))
    }
  }

  const stopOrCancel = async (sessionId = activeIdRef.current) => {
    if (!agentRef.current || offlineRef.current || !sessionId) return
    const tab = tabsRef.current.find((item) => item.summary.sessionId === sessionId)
    try {
      if (tab?.summary.state === "queued") {
        await agentRef.current.cancelQueuedTurn(sessionId)
      } else {
        await agentRef.current.abortChatTurn(sessionId)
      }
    } catch (abortError) {
      setError(errorText(abortError))
    }
  }

  const chooseContextFiles = async () => {
    const sessionId = activeIdRef.current
    if (!hostRef.current || offlineRef.current || !sessionId) return
    try {
      const relativePaths = await hostRef.current.selectChatContextFiles()
      appendContexts(
        sessionId,
        relativePaths.map((relativePath) => ({
          id: crypto.randomUUID(),
          kind: "file",
          path: relativePath,
        })),
      )
    } catch (chooseError) {
      setError(errorText(chooseError))
    }
  }

  const setModel = async (modelId: string) => {
    if (!agentRef.current || offlineRef.current || !activeIdRef.current) return
    try {
      await agentRef.current.setChatModel(activeIdRef.current, modelId)
    } catch (modelError) {
      setError(errorText(modelError))
    }
  }

  const persistModelPreferences = (preferences: ModelPreferencesDto) => {
    if (!hostRef.current || offlineRef.current) return
    const chatHost = hostRef.current
    modelPreferencesSaveRef.current = modelPreferencesSaveRef.current.then(async () => {
      try {
        await chatHost.saveIdeSettings({ modelPreferences: preferences })
      } catch (preferencesError) {
        log.warn("model preferences save failed", preferencesError)
        setError(errorText(preferencesError))
      }
    })
  }

  const onChatModelChange = (spec: string, pinned: string[], recentModels: string[]) => {
    const preferences = {
      pinnedModelSpecs: [...pinned],
      recentModelSpecs: [...recentModels],
    }
    setModelPreferences(preferences)
    persistModelPreferences(preferences)
    if (spec && spec !== activeTab?.summary.modelId) void setModel(spec)
  }

  const setThinking = async (level: string) => {
    if (!agentRef.current || offlineRef.current || !activeIdRef.current) return
    try {
      await agentRef.current.setChatThinkingLevel(activeIdRef.current, level)
    } catch (thinkingError) {
      setError(errorText(thinkingError))
    }
  }

  const reorderTabs = (targetId: string) => {
    const draggedId = dragSessionIdRef.current
    if (!draggedId || draggedId === targetId) return
    updateTabs((current) => {
      const from = current.findIndex((tab) => tab.summary.sessionId === draggedId)
      const to = current.findIndex((tab) => tab.summary.sessionId === targetId)
      if (from < 0 || to < 0) return current
      const reordered = [...current]
      const [moved] = reordered.splice(from, 1)
      reordered.splice(to, 0, moved!)
      return reordered
    })
    dragSessionIdRef.current = null
    void persistWorkspace()
  }

  const respondPermission = (decision: ToolPermissionDecision) => {
    const pending = pendingPermissionRef.current
    if (!pending) return
    updatePendingPermission(null)
    pending.resolve({ requestId: pending.request.requestId, decision })
  }

  const respondInput = (cancelInput = false) => {
    const pending = pendingInputRef.current
    if (!pending) return
    updatePendingInput(null)
    pending.resolve({
      requestId: pending.request.requestId,
      text: cancelInput ? undefined : inputReply,
      cancelled: cancelInput,
    })
    setInputReply("")
  }

  const openLocation = useCallback((path: string, line?: number) => {
    if (!offlineRef.current) void hostRef.current?.openProjectFile(path, line ?? null)
  }, [])

  const showDiff = useCallback((path: string) => {
    if (!offlineRef.current) void hostRef.current?.showProjectDiff(path)
  }, [])

  const onMarkdownClick = (event: ReactMouseEvent<HTMLElement>) => {
    const anchor = (event.target as HTMLElement).closest("a")
    const href = anchor?.getAttribute("href")
    if (!href) return
    event.preventDefault()
    if (/^https?:\/\//i.test(href)) void hostRef.current?.openExternalUrl(href)
  }

  return (
    <main className="chat-app">
      <header className="session-bar">
        <div className="session-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.summary.sessionId}
              className={`session-tab ${tab.summary.sessionId === activeId ? "active" : ""}`}
              role="tab"
              aria-selected={tab.summary.sessionId === activeId}
              title={tab.summary.title}
              draggable
              onDragStart={() => {
                dragSessionIdRef.current = tab.summary.sessionId
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => reorderTabs(tab.summary.sessionId)}
              onClick={() => void activate(tab.summary.sessionId)}
            >
              <StatusDot state={tab.summary.state} unread={tab.summary.unread} />
              <span className="session-title">{tab.summary.title}</span>
              {tab.summary.queuePosition ? (
                <span className="queue-badge">{tab.summary.queuePosition}</span>
              ) : null}
              <span
                className="tab-close"
                role="button"
                title={t("chat:closeSession")}
                onClick={(event) => void closeSession(tab.summary.sessionId, event)}
              >
                <X size={13} strokeWidth={1.8} />
              </span>
            </button>
          ))}
        </div>
        <div className="session-actions">
          <button
            className="icon-button"
            title={t("chat:newSession")}
            onClick={() => void newSession()}
          >
            <Plus size={17} />
          </button>
          <button
            className="icon-button"
            title={t("chat:recentSessions")}
            onClick={() => void refreshRecent()}
          >
            <History size={16} />
          </button>
          <button
            className="icon-button"
            title={t("chat:openSettings")}
            onClick={() => void hostRef.current?.openIdeSettings()}
          >
            <Settings2 size={16} />
          </button>
          <span
            className={`connection-dot ${agentStatus === "ready" ? "ready" : ""} ${offline ? "offline" : ""}`}
            title={`${hostStatus} / ${agentStatus}`}
          />
        </div>
        {recentOpen ? (
          <div className="recent-menu">
            <div className="recent-menu-title">{t("chat:recentSessions")}</div>
            {recent.length > 0 ? (
              recent.map((session) => (
                <button
                  key={session.sessionId}
                  className="recent-item"
                  onClick={() => void openRecent(session)}
                >
                  <MessageSquareText size={14} />
                  <span>
                    <strong>{session.title}</strong>
                    <small>{new Date(session.updatedAt).toLocaleString()}</small>
                  </span>
                </button>
              ))
            ) : (
              <div className="empty-menu">{t("chat:noRecent")}</div>
            )}
          </div>
        ) : null}
      </header>

      {pendingPermission && pendingPermission.request.sessionId !== activeId ? (
        <button
          className="attention-bar"
          onClick={() => void activate(pendingPermission.request.sessionId)}
        >
          <ShieldCheck size={15} />
          <span>{t("chat:backgroundPermission")}</span>
          <span>{t("common:open")}</span>
        </button>
      ) : null}
      {pendingInput && pendingInput.request.sessionId !== activeId ? (
        <button
          className="attention-bar"
          onClick={() => void activate(pendingInput.request.sessionId)}
        >
          <MessageSquareText size={15} />
          <span>{t("chat:backgroundInput")}</span>
          <span>{t("common:open")}</span>
        </button>
      ) : null}

      {activeTab ? (
        <AssistantChat
          key={activeTab.summary.sessionId}
          tab={activeTab}
          draft={activeDraft}
          contexts={activeContexts}
          modelOptions={activeModelOptions}
          modelPreferences={modelPreferences}
          thinkingOptions={thinkingOptions}
          busy={isBusy}
          queued={isQueued}
          connected={agentStatus === "ready"}
          offline={offline}
          error={error}
          pendingPermission={
            pendingPermission?.request.sessionId === activeTab.summary.sessionId
              ? pendingPermission
              : null
          }
          pendingInput={
            pendingInput?.request.sessionId === activeTab.summary.sessionId
              ? pendingInput
              : null
          }
          inputReply={inputReply}
          onInputReplyChange={setInputReply}
          onRespondPermission={respondPermission}
          onRespondInput={respondInput}
          onDismissError={() => setError(null)}
          onDraftChange={(value) =>
            setDrafts((current) => ({
              ...current,
              [activeTab.summary.sessionId]: value,
            }))
          }
          onSend={(text) => sendMessage(activeTab.summary.sessionId, text)}
          onCancel={() => stopOrCancel(activeTab.summary.sessionId)}
          onChooseContextFiles={chooseContextFiles}
          onRemoveContext={(contextId) =>
            updateContexts((current) => ({
              ...current,
              [activeTab.summary.sessionId]: (
                current[activeTab.summary.sessionId] ?? []
              ).filter((item) => item.id !== contextId),
            }))
          }
          onModelChange={onChatModelChange}
          onThinkingChange={setThinking}
          onOpenLocation={openLocation}
          onShowDiff={showDiff}
          onMarkdownClick={onMarkdownClick}
        />
      ) : (
        <section className="conversation">
          <div className="empty-state">
            <LoaderCircle className="spin" size={22} />
            <span>{t("chat:loadingSession")}</span>
          </div>
        </section>
      )}
    </main>
  )
}

type AssistantChatProps = {
  tab: ChatTab
  draft: string
  contexts: ChatContextItem[]
  modelOptions: ModelPickerOption[]
  modelPreferences: ModelPreferencesDto
  thinkingOptions: ThinkingOption[]
  busy: boolean
  queued: boolean
  connected: boolean
  offline: boolean
  error: string | null
  pendingPermission: PendingPermission | null
  pendingInput: PendingInput | null
  inputReply: string
  onInputReplyChange: (value: string) => void
  onRespondPermission: (decision: ToolPermissionDecision) => void
  onRespondInput: (cancelled?: boolean) => void
  onDismissError: () => void
  onDraftChange: (value: string) => void
  onSend: (text: string) => Promise<void>
  onCancel: () => Promise<void>
  onChooseContextFiles: () => Promise<void>
  onRemoveContext: (contextId: string) => void
  onModelChange: (spec: string, pinned: string[], recent: string[]) => void
  onThinkingChange: (level: string) => Promise<void>
  onOpenLocation: (path: string, line?: number) => void
  onShowDiff: (path: string) => void
  onMarkdownClick: (event: ReactMouseEvent<HTMLElement>) => void
}

function AssistantChat(props: AssistantChatProps) {
  const { t } = useAppTranslation("chat")
  const running = props.busy || props.queued
  const runtime = useExternalStoreRuntime<ChatMessage>({
    messages: props.tab.messages,
    convertMessage: convertChatMessage,
    isRunning: running,
    isSendDisabled: running || (!props.offline && !props.connected),
    onNew: async (message: AppendMessage) => {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
      await props.onSend(text)
    },
    onCancel: props.onCancel,
  })

  useEffect(() => {
    if (runtime.thread.composer.getState().text !== props.draft) {
      runtime.thread.composer.setText(props.draft)
    }
  }, [props.draft, runtime])

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="assistant-thread">
        <ThreadPrimitive.Viewport
          className="conversation assistant-viewport"
          autoScroll
          onClick={props.onMarkdownClick}
        >
          <div className="message-stream">
            <ThreadPrimitive.Empty>
              <div className="new-session-state">
                <div className="new-session-mark">
                  <Sparkles size={22} />
                </div>
                <h1>{t("chat:startSession")}</h1>
                <p>{modelLabel(props.tab.summary.modelId, t("chat:defaultModel"))}</p>
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages
              components={{
                Message: () => (
                  <ChatMessageView
                    onOpenLocation={props.onOpenLocation}
                    onShowDiff={props.onShowDiff}
                  />
                ),
              }}
            />

            {props.pendingPermission ? (
              <PermissionCard
                pending={props.pendingPermission}
                onRespond={props.onRespondPermission}
                onOpenLocation={props.onOpenLocation}
              />
            ) : null}
            {props.pendingInput ? (
              <InputCard
                pending={props.pendingInput}
                value={props.inputReply}
                onChange={props.onInputReplyChange}
                onRespond={props.onRespondInput}
              />
            ) : null}
          </div>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>

      {props.error ? (
        <div className="error-banner">
          <AlertTriangle size={15} />
          <span>{props.error}</span>
          <button
            className="icon-button"
            title={t("common:dismiss")}
            onClick={props.onDismissError}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      <ComposerPrimitive.Root className="composer-shell">
        {props.contexts.length > 0 ? (
          <div className="context-list">
            {props.contexts.map((context) => (
              <span key={context.id} className="context-chip" title={context.path}>
                <FileCode2 size={13} />
                <span>{context.path}</span>
                <button
                  type="button"
                  title={t("chat:removeContext")}
                  onClick={() => props.onRemoveContext(context.id)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <ComposerPrimitive.Input
          className="composer-input"
          placeholder={t("chat:typeMessage")}
          submitMode="enter"
          onChange={(event) => props.onDraftChange(event.currentTarget.value)}
        />
        <div className="composer-toolbar">
          <div className="composer-selectors">
            <button
              type="button"
              className="toolbar-button"
              title={t("chat:addFileContext")}
              disabled={props.offline}
              onClick={() => void props.onChooseContextFiles()}
            >
              <Paperclip size={15} />
            </button>
            <ModelPicker
              options={props.modelOptions}
              value={props.tab.summary.modelId ?? ""}
              pinnedSpecs={props.modelPreferences.pinnedModelSpecs ?? []}
              recentSpecs={props.modelPreferences.recentModelSpecs ?? []}
              variant="compact"
              placeholder={t("chat:defaultModel")}
              ariaLabel={t("chat:model")}
              disabled={running || props.offline}
              onChange={props.onModelChange}
            />
            <select
              className="composer-select-trigger composer-thinking-select"
              aria-label={t("chat:thinkingLevel")}
              value={props.tab.summary.thinkingLevel ?? "off"}
              disabled={running || props.offline}
              onChange={(event) => void props.onThinkingChange(event.currentTarget.value)}
            >
              {props.thinkingOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="composer-actions">
            <button type="button" className="toolbar-button" title={t("common:more")}>
              <MoreHorizontal size={16} />
            </button>
            {running ? (
              <ComposerPrimitive.Cancel
                className="stop-button"
                title={props.queued ? t("chat:cancelQueued") : t("chat:stop")}
              >
                <CircleStop size={18} />
              </ComposerPrimitive.Cancel>
            ) : (
              <ComposerPrimitive.Send className="send-button" title={t("chat:send")}>
                <Send size={17} fill="currentColor" />
              </ComposerPrimitive.Send>
            )}
          </div>
        </div>
      </ComposerPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}

function ChatMessageView({
  onOpenLocation,
  onShowDiff,
}: {
  onOpenLocation: (path: string, line?: number) => void
  onShowDiff: (path: string) => void
}) {
  const { t } = useAppTranslation("chat")
  const role = useAuiState((state) => state.message.role)
  const status = useAuiState((state) => state.message.status)
  const ToolRenderer = useCallback(
    (part: ToolCallMessagePartProps) => (
      <ToolPart part={part} onOpenLocation={onOpenLocation} onShowDiff={onShowDiff} />
    ),
    [onOpenLocation, onShowDiff],
  )

  if (role === "user") {
    return (
      <MessagePrimitive.Root className="chat-message user">
        <MessagePrimitive.Parts components={{ Text: UserText }} />
      </MessagePrimitive.Root>
    )
  }

  return (
    <MessagePrimitive.Root className={`chat-message ${role}`}>
      <div className="assistant-gutter">
        {role === "assistant" ? <Bot size={16} /> : <AlertTriangle size={15} />}
      </div>
      <div className="assistant-content">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            Reasoning: ReasoningPart,
            tools: { Fallback: ToolRenderer },
            data: { by_name: { "vibefly-notice": NoticePart } },
          }}
        />
        {status?.type === "running" ? <span className="streaming-caret" /> : null}
        {status?.type === "incomplete" && status.reason === "error" ? (
          <button className="retry-button">
            <RotateCcw size={13} /> {t("chat:retry")}
          </button>
        ) : null}
      </div>
    </MessagePrimitive.Root>
  )
}

function UserText({ text }: { text: string }) {
  return <div className="user-message-text">{text}</div>
}

function MarkdownText() {
  return (
    <StreamdownTextPrimitive
      containerClassName="markdown-body"
      plugins={{ code, cjk }}
      remarkPlugins={[remarkBreaks]}
      controls={{ code: true, table: false }}
      linkSafety={{ enabled: false }}
      security={{
        allowedProtocols: ["http", "https"],
        allowedLinkPrefixes: ["*"],
        allowedImagePrefixes: [],
        allowDataImages: false,
      }}
    />
  )
}

function ReasoningPart({ text }: { text: string }) {
  const { t } = useAppTranslation("chat")
  const [open, setOpen] = useState(true)
  return (
    <div className={`thinking-block ${open ? "open" : ""}`}>
      <button className="thinking-toggle" onClick={() => setOpen((value) => !value)}>
        <Brain size={15} />
        <span>{t("chat:reasoning")}</span>
        <ChevronDown size={14} />
      </button>
      {open ? <div className="thinking-content">{text}</div> : null}
    </div>
  )
}

type NoticeData = { level: "info" | "warning" | "error"; text: string }

function NoticePart({ data }: DataMessagePartProps<NoticeData>) {
  return (
    <div className={`notice-part ${data.level === "error" ? "error" : ""}`}>
      <AlertTriangle size={14} />
      {data.text}
    </div>
  )
}

function ToolPart({
  part,
  onOpenLocation,
  onShowDiff,
}: {
  part: ToolCallMessagePartProps
  onOpenLocation: (path: string, line?: number) => void
  onShowDiff: (path: string) => void
}) {
  const { t } = useAppTranslation("chat")
  const [expanded, setExpanded] = useState(false)
  const artifact = (part.artifact ?? {}) as ToolArtifact
  const status = artifact.status ?? (part.result === undefined ? "running" : "completed")
  const location = artifact.locations?.[0]
  return (
    <div className={`tool-part ${status === "failed" ? "failed" : ""}`}>
      <button className="tool-summary" onClick={() => setExpanded((value) => !value)}>
        <span className="tool-icon">
          {status === "running" || status === "pending" ? (
            <LoaderCircle size={13} className="spin" />
          ) : status === "failed" ? (
            <AlertTriangle size={13} />
          ) : (
            <Check size={13} />
          )}
        </span>
        <Wrench size={14} />
        <strong>{part.toolName}</strong>
        {location ? (
          <span
            className="tool-path"
            title={location.path}
            onClick={(event) => {
              event.stopPropagation()
              onOpenLocation(location.path, location.line)
            }}
          >
            {location.path}
          </span>
        ) : null}
        {artifact.output && !expanded ? (
          <span className="tool-result-short">{artifact.output.split("\n", 1)[0]}</span>
        ) : null}
        {(part.toolName === "edit" || part.toolName === "write") && location ? (
          <span
            className="tool-diff"
            role="button"
            title={t("chat:showDiff")}
            onClick={(event) => {
              event.stopPropagation()
              onShowDiff(location.path)
            }}
          >
            <GitCompareArrows size={13} />
          </span>
        ) : null}
        <ChevronDown size={14} className={expanded ? "rotated" : ""} />
      </button>
      {expanded ? (
        <div className="tool-detail">
          {part.argsText ? <pre>{formatJson(part.argsText)}</pre> : null}
          {artifact.output ? <pre>{artifact.output}</pre> : null}
        </div>
      ) : null}
    </div>
  )
}

function PermissionCard({
  pending,
  onRespond,
  onOpenLocation,
}: {
  pending: PendingPermission
  onRespond: (decision: ToolPermissionDecision) => void
  onOpenLocation: (path: string, line?: number) => void
}) {
  const { t } = useAppTranslation("chat")
  return (
    <div className="interaction-card permission-card">
      <div className="interaction-heading">
        <ShieldCheck size={17} />
        <span>{t("chat:toolApproval")}</span>
      </div>
      <strong>{pending.request.title}</strong>
      {pending.request.command ? (
        <pre className="permission-command">$ {pending.request.command}</pre>
      ) : null}
      {pending.request.locations?.map((location) => (
        <button
          key={`${location.path}:${location.line ?? ""}`}
          className="file-link"
          onClick={() => onOpenLocation(location.path, location.line)}
        >
          <FileCode2 size={13} /> {location.path}
        </button>
      ))}
      <div className="permission-actions">
        <button className="secondary-button" onClick={() => onRespond("reject_once")}>
          {t("common:reject")}
        </button>
        <button className="secondary-button" onClick={() => onRespond("reject_always")}>
          {t("chat:alwaysReject")}
        </button>
        <button className="secondary-button" onClick={() => onRespond("allow_always")}>
          {t("chat:alwaysAllow")}
        </button>
        <button className="primary-button" onClick={() => onRespond("allow_once")}>
          {t("chat:allowOnce")}
        </button>
      </div>
    </div>
  )
}

function InputCard({
  pending,
  value,
  onChange,
  onRespond,
}: {
  pending: PendingInput
  value: string
  onChange: (value: string) => void
  onRespond: (cancelled?: boolean) => void
}) {
  const { t } = useAppTranslation("chat")
  return (
    <div className="interaction-card input-card">
      <div className="interaction-heading">
        <MessageSquareText size={17} />
        <span>{t("chat:agentNeedsInput")}</span>
      </div>
      <p>{pending.request.prompt}</p>
      <textarea
        value={value}
        placeholder={pending.request.placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <div className="permission-actions">
        <button className="secondary-button" onClick={() => onRespond(true)}>
          {t("common:cancel")}
        </button>
        <button className="primary-button" onClick={() => onRespond(false)}>
          {t("common:submit")}
        </button>
      </div>
    </div>
  )
}

function StatusDot(props: { state: ChatSessionSummary["state"]; unread: boolean }) {
  return (
    <span className={`status-dot ${props.state} ${props.unread ? "unread" : ""}`}>
      {props.state === "running" ? <LoaderCircle size={12} className="spin" /> : null}
      {props.state === "queued" ? <Clock3 size={11} /> : null}
      {props.state === "waiting_permission" ? <ShieldCheck size={11} /> : null}
      {props.state === "waiting_input" ? <MessageSquareText size={11} /> : null}
      {props.state === "error" ? <AlertTriangle size={11} /> : null}
    </span>
  )
}

function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
