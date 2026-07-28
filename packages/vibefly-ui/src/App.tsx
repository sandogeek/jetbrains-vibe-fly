import DOMPurify from "dompurify"
import {
  AlertTriangle,
  Bot,
  Brain,
  Check,
  ChevronDown,
  CircleStop,
  Clock3,
  FileCode2,
  FolderOpen,
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
} from "lucide-solid"
import { marked } from "marked"
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js"
import type { SimpleRpcPeer } from "@sandogeek/simple-rpc"
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
import type { Ui2Host } from "./generated/rpc"
import { log } from "./log"
import { connectAgentRpc, type AgentStatus } from "./rpc/agent"
import { createUiRpc } from "./rpc/client"
import { bindConsoleToHost } from "./rpc/console"

type ChatTab = ChatSessionSnapshot

type PendingPermission = {
  request: ToolPermissionRequest
  resolve: (response: ToolPermissionResponse) => void
}

type PendingInput = {
  request: UserInputRequest
  resolve: (response: UserInputResponse) => void
}

const MAX_OPEN_TABS = 8
const renderer = new marked.Renderer()
renderer.html = ({ text }: { text: string }) => escapeHtml(text)

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function markdown(value: string): string {
  const html = marked.parse(value, { gfm: true, breaks: true, renderer }) as string
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "del",
      "code",
      "pre",
      "blockquote",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "a",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "hr",
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
  })
}

function textPart(message: ChatMessage): string {
  return message.parts
    .filter((part): part is Extract<ChatPart, { kind: "text" }> => part.kind === "text")
    .map((part) => part.text)
    .join("")
}

function modelLabel(modelId?: string): string {
  if (!modelId) return "Default model"
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
  const isZh = navigator.language.toLowerCase().startsWith("zh")
  const t = (zh: string, en: string) => (isZh ? zh : en)
  const [hostStatus, setHostStatus] = createSignal("connecting")
  const [agentStatus, setAgentStatus] = createSignal<AgentStatus>("idle")
  const [tabs, setTabs] = createSignal<ChatTab[]>([])
  const [activeId, setActiveId] = createSignal("")
  const [drafts, setDrafts] = createSignal<Record<string, string>>({})
  const [contexts, setContexts] = createSignal<Record<string, ChatContextItem[]>>({})
  const [models, setModels] = createSignal<Record<string, ChatModelOption[]>>({})
  const [recent, setRecent] = createSignal<RecentChatSession[]>([])
  const [recentOpen, setRecentOpen] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [pendingPermission, setPendingPermission] = createSignal<PendingPermission | null>(null)
  const [pendingInput, setPendingInput] = createSignal<PendingInput | null>(null)
  const [inputReply, setInputReply] = createSignal("")
  const [offline, setOffline] = createSignal(false)
  let host: Ui2Host | null = null
  let agent: Ui2Agent | null = null
  let projectRoot = ""
  let peer: SimpleRpcPeer | null = null
  let stopAgent: (() => void) | null = null
  let unbindConsole: (() => void) | null = null
  let cancelled = false
  let conversationElement: HTMLElement | undefined
  let dragSessionId: string | null = null

  const activeTab = createMemo(() => tabs().find((tab) => tab.summary.sessionId === activeId()) ?? null)
  const activeDraft = createMemo(() => drafts()[activeId()] ?? "")
  const activeContexts = createMemo(() => contexts()[activeId()] ?? [])
  const isBusy = createMemo(() => {
    const state = activeTab()?.summary.state
    return state === "running" || state === "waiting_permission" || state === "waiting_input"
  })
  const isQueued = createMemo(() => activeTab()?.summary.state === "queued")

  onCleanup(() => {
    cancelled = true
    stopAgent?.()
    stopAgent = null
    unbindConsole?.()
    unbindConsole = null
    peer?.close()
    peer = null
    pendingPermission()?.resolve({
      requestId: pendingPermission()!.request.requestId,
      decision: "cancelled",
    })
    pendingInput()?.resolve({
      requestId: pendingInput()!.request.requestId,
      cancelled: true,
    })
  })

  onMount(() => {
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
    })

    if (!rpc) {
      setOffline(true)
      setHostStatus("browser preview")
      setAgentStatus("unavailable")
      const demo = demoTab()
      setTabs([demo])
      setActiveId(demo.summary.sessionId)
      scrollToBottom()
      return
    }

    host = rpc.ui2Host
    peer = rpc.peer
    unbindConsole = bindConsoleToHost(rpc.ui2Host)
    void bootstrap(rpc.ui2Host)
  })

  const bootstrap = async (ui2Host: Ui2Host) => {
    try {
      await ui2Host.getAppVersion()
      await ui2Host.chatUiReady()
      projectRoot = await ui2Host.getProjectRoot()
      const workspace = await ui2Host.getChatWorkspaceState()
      if (cancelled) return
      setHostStatus("connected")

      const connection = connectAgentRpc({
        ui2Host,
        isStopped: () => cancelled,
        onReady(proxy) {
          currentAgentProxy = proxy
          agent = proxy
        },
        onStatus(status) {
          setAgentStatus(status)
        },
        onChatEvents(batch) {
          applyBatch(batch)
        },
        requestToolPermission(request) {
          return new Promise((resolve) => {
            setPendingPermission({ request, resolve })
          })
        },
        requestUserInput(request) {
          return new Promise((resolve) => {
            setInputReply("")
            setPendingInput({ request, resolve })
          })
        },
      })
      stopAgent = connection.stop

      await waitForAgent()
      const restored: ChatTab[] = []
      for (const sessionId of (workspace.sessionIds ?? []).slice(0, MAX_OPEN_TABS)) {
        try {
          restored.push(await agent!.openChatSession({ projectRoot, sessionId }))
        } catch (restoreError) {
          log.warn("chat session restore failed", sessionId, restoreError)
        }
      }
      if (restored.length === 0) {
        const recentSessions = await agent!.listRecentChatSessions({ projectRoot })
        setRecent(recentSessions)
        for (const recentSession of recentSessions) {
          try {
            restored.push(
              await agent!.openChatSession({
                projectRoot,
                sessionId: recentSession.sessionId,
                sessionFile: recentSession.sessionFile,
              }),
            )
            break
          } catch (restoreError) {
            log.warn("recent chat session restore failed", recentSession.sessionId, restoreError)
          }
        }
        if (restored.length === 0) restored.push(await agent!.createChatSession({ projectRoot }))
      }
      if (cancelled) return
      setTabs(restored)
      const savedActiveId = workspace.activeSessionId ?? ""
      const restoredActive = restored.some((tab) => tab.summary.sessionId === savedActiveId)
        ? savedActiveId
        : restored[0]!.summary.sessionId
      setActiveId(restoredActive)
      await loadModels(restoredActive)
      scrollToBottom()
      void persistWorkspace()
    } catch (bootstrapError) {
      const message = bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError)
      log.error("chat bootstrap failed", message)
      setError(message)
      setHostStatus("error")
    }
  }

  const waitForAgent = async () => {
    const deadline = Date.now() + 30_000
    while (!agent && Date.now() < deadline && !cancelled) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      // The connection helper exposes the proxy through its ready callback below.
      if (agentStatus() === "ready") agent = currentAgentProxy
    }
    if (!agent) throw new Error(t("Agent 连接超时", "Agent connection timed out"))
  }

  let currentAgentProxy: Ui2Agent | null = null

  const applyBatch = (batch: ChatEventBatch) => {
    for (const event of batch.events) applyEvent(event)
    queueMicrotask(scrollToBottom)
  }

  const applyEvent = (event: ChatEvent) => {
    if (event.kind === "snapshot") {
      upsertTab(event.snapshot)
      return
    }
    if (event.kind === "summary") {
      setTabs((current) =>
        current.map((tab) =>
          tab.summary.sessionId === event.summary.sessionId
            ? {
                ...tab,
                summary: {
                  ...tab.summary,
                  ...event.summary,
                  unread: event.summary.sessionId === activeId() ? false : event.summary.unread,
                },
              }
            : tab,
        ),
      )
      return
    }
    if (event.kind === "message") {
      updateMessages(event.sessionId, (messages) => {
        const duplicate = messages.find((message) => message.id === event.message.id)
        if (duplicate) return messages.map((message) => (message.id === event.message.id ? event.message : message))
        return [...messages, event.message]
      })
      return
    }
    if (event.kind === "partDelta") {
      updateMessage(event.sessionId, event.messageId, (message) => {
        const index = message.parts.findIndex((part) => part.kind === event.partKind)
        if (index < 0) {
          return { ...message, parts: [...message.parts, { kind: event.partKind, text: event.delta }] }
        }
        const parts = [...message.parts]
        const part = parts[index] as Extract<ChatPart, { kind: "text" | "thinking" }>
        parts[index] = { ...part, text: part.text + event.delta }
        return { ...message, parts }
      })
      return
    }
    if (event.kind === "messageStatus") {
      updateMessage(event.sessionId, event.messageId, (message) => ({ ...message, status: event.status }))
      return
    }
    if (event.kind === "tool") {
      updateMessage(event.sessionId, event.messageId, (message) => {
        const index = message.parts.findIndex(
          (part) => part.kind === "tool" && part.toolCallId === event.part.toolCallId,
        )
        if (index < 0) return { ...message, parts: [...message.parts, event.part] }
        const parts = [...message.parts]
        parts[index] = { ...(parts[index] as Extract<ChatPart, { kind: "tool" }>), ...event.part }
        return { ...message, parts }
      })
      if (
        event.part.status === "completed" &&
        (event.part.name === "edit" || event.part.name === "write") &&
        event.part.locations?.length
      ) {
        void host?.refreshProjectFiles(event.part.locations.map((location) => location.path)).catch(() => {})
      }
      return
    }
    if (event.kind === "turnComplete") {
      setTabs((current) =>
        current.map((tab) =>
          tab.summary.sessionId === event.sessionId
            ? {
                ...tab,
                summary: {
                  ...tab.summary,
                  state: event.ok ? "completed" : event.aborted ? "idle" : "error",
                  unread: event.sessionId !== activeId(),
                },
              }
            : tab,
        ),
      )
      if (event.error && !event.aborted) setError(event.error)
      return
    }
    if (event.kind === "sessionReleased") {
      setTabs((current) => current.filter((tab) => tab.summary.sessionId !== event.sessionId))
      return
    }
    if (event.kind === "disconnected") setError(event.message)
  }

  const upsertTab = (snapshot: ChatTab) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.summary.sessionId === snapshot.summary.sessionId)
      if (index < 0) return [...current, snapshot]
      return current.map((tab, tabIndex) => (tabIndex === index ? snapshot : tab))
    })
  }

  const updateMessages = (sessionId: string, update: (messages: ChatMessage[]) => ChatMessage[]) => {
    setTabs((current) =>
      current.map((tab) =>
        tab.summary.sessionId === sessionId ? { ...tab, messages: update(tab.messages) } : tab,
      ),
    )
  }

  const updateMessage = (sessionId: string, messageId: string, update: (message: ChatMessage) => ChatMessage) => {
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
  }

  const activate = async (sessionId: string) => {
    setActiveId(sessionId)
    setTabs((current) =>
      current.map((tab) =>
        tab.summary.sessionId === sessionId
          ? { ...tab, summary: { ...tab.summary, unread: false } }
          : tab,
      ),
    )
    await persistWorkspace()
    if (agent && !offline()) {
      void agent.markChatSessionRead(sessionId).catch(() => {})
      await loadModels(sessionId)
    }
    scrollToBottom()
  }

  const loadModels = async (sessionId: string) => {
    if (!agent || models()[sessionId]) return
    try {
      const options = await agent.listChatModels(sessionId)
      setModels((current) => ({ ...current, [sessionId]: options }))
    } catch (modelError) {
      log.debug("model list unavailable", modelError)
    }
  }

  const newSession = async () => {
    setRecentOpen(false)
    if (tabs().length >= MAX_OPEN_TABS) {
      setError(t("最多同时打开 8 个会话，请先关闭一个。", "A maximum of 8 sessions can be open."))
      return
    }
    if (offline()) {
      const id = `demo-${Date.now()}`
      const tab: ChatTab = {
        summary: {
          sessionId: id,
          title: t("新会话", "New session"),
          state: "idle",
          unread: false,
          updatedAt: Date.now(),
          messageCount: 0,
        },
        messages: [],
      }
      setTabs((current) => [...current, tab])
      setActiveId(id)
      return
    }
    if (!agent) return
    try {
      const snapshot = await agent.createChatSession({ projectRoot })
      setTabs((current) => [...current, snapshot])
      await activate(snapshot.summary.sessionId)
    } catch (createError) {
      setError(errorText(createError))
    }
  }

  const closeSession = async (sessionId: string, event: MouseEvent) => {
    event.stopPropagation()
    const tab = tabs().find((item) => item.summary.sessionId === sessionId)
    if (!tab) return
    const running = ["running", "waiting_permission", "waiting_input"].includes(tab.summary.state)
    if (running && !window.confirm(t("该会话仍在运行。终止并关闭？", "This session is running. Stop and close it?"))) return
    try {
      if (running && agent) await agent.abortChatTurn(sessionId)
      if (agent && !offline()) await agent.releaseChatSession(sessionId)
      let nextTabs = tabs().filter((item) => item.summary.sessionId !== sessionId)
      setTabs(nextTabs)
      if (nextTabs.length === 0) {
        await newSession()
        nextTabs = tabs()
      }
      if (activeId() === sessionId && nextTabs[0]) await activate(nextTabs[0].summary.sessionId)
      void persistWorkspace()
    } catch (closeError) {
      setError(errorText(closeError))
    }
  }

  const refreshRecent = async () => {
    setRecentOpen((open) => !open)
    if (!recentOpen() || !agent || offline()) return
    try {
      setRecent(await agent.listRecentChatSessions({ projectRoot }))
    } catch (recentError) {
      setError(errorText(recentError))
    }
  }

  const openRecent = async (session: RecentChatSession) => {
    setRecentOpen(false)
    const existing = tabs().find((tab) => tab.summary.sessionId === session.sessionId)
    if (existing) {
      await activate(existing.summary.sessionId)
      return
    }
    if (tabs().length >= MAX_OPEN_TABS || !agent) {
      setError(t("请先关闭一个会话。", "Close a session first."))
      return
    }
    try {
      const snapshot = await agent.openChatSession({
        projectRoot,
        sessionId: session.sessionId,
        sessionFile: session.sessionFile,
      })
      setTabs((current) => [...current, snapshot])
      await activate(snapshot.summary.sessionId)
    } catch (openError) {
      setError(errorText(openError))
    }
  }

  const sendMessage = async () => {
    const sessionId = activeId()
    const text = activeDraft().trim()
    if (!sessionId || !text || isBusy() || isQueued()) return
    if (offline()) {
      updateMessages(sessionId, (messages) => [
        ...messages,
        { id: `local-${Date.now()}`, role: "user", parts: [{ kind: "text", text }], createdAt: Date.now(), status: "complete" },
      ])
      setDraft(sessionId, "")
      return
    }
    if (!agent) return
    const clientMessageId = crypto.randomUUID()
    setDraft(sessionId, "")
    setError(null)
    try {
      await agent.sendChatMessage({
        sessionId,
        text,
        contexts: activeContexts(),
        clientMessageId,
      })
      setContexts((current) => ({ ...current, [sessionId]: [] }))
    } catch (sendError) {
      setDraft(sessionId, text)
      setError(errorText(sendError))
    }
  }

  const stopOrCancel = async () => {
    if (!agent || offline()) return
    try {
      if (isQueued()) await agent.cancelQueuedTurn(activeId())
      else await agent.abortChatTurn(activeId())
    } catch (abortError) {
      setError(errorText(abortError))
    }
  }

  const setDraft = (sessionId: string, value: string) => {
    setDrafts((current) => ({ ...current, [sessionId]: value }))
  }

  const appendFileContexts = (sessionId: string, relativePaths: string[]) => {
    appendContexts(
      sessionId,
      relativePaths.map((relativePath) => ({
        id: crypto.randomUUID(),
        kind: "file",
        path: relativePath,
      })),
    )
  }

  const appendContexts = (sessionId: string, incoming: ChatContextItem[]) => {
    if (!sessionId || incoming.length === 0) return
    setContexts((current) => {
      const existing = current[sessionId] ?? []
      const keys = new Set(existing.map((item) => `${item.kind}:${item.path}:${item.startLine ?? ""}:${item.endLine ?? ""}`))
      const added = incoming.filter((item) => {
        const key = `${item.kind}:${item.path}:${item.startLine ?? ""}:${item.endLine ?? ""}`
        if (!item.path || keys.has(key)) return false
        keys.add(key)
        return true
      })
      return { ...current, [sessionId]: [...existing, ...added] }
    })
  }

  const chooseContextFiles = async () => {
    if (!host || offline() || !activeId()) return
    try {
      appendFileContexts(activeId(), await host.selectChatContextFiles())
    } catch (chooseError) {
      setError(errorText(chooseError))
    }
  }

  const setModel = async (modelId: string) => {
    if (!agent || offline() || !activeId()) return
    try {
      await agent.setChatModel(activeId(), modelId)
    } catch (modelError) {
      setError(errorText(modelError))
    }
  }

  const setThinking = async (level: string) => {
    if (!agent || offline() || !activeId()) return
    try {
      await agent.setChatThinkingLevel(activeId(), level)
    } catch (thinkingError) {
      setError(errorText(thinkingError))
    }
  }

  const persistWorkspace = async () => {
    if (!host || offline()) return
    try {
      await host.saveChatWorkspaceState({
        sessionIds: tabs().map((tab) => tab.summary.sessionId).slice(0, MAX_OPEN_TABS),
        activeSessionId: activeId(),
      })
    } catch (persistError) {
      log.debug("workspace state save failed", persistError)
    }
  }

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (conversationElement) conversationElement.scrollTop = conversationElement.scrollHeight
    })
  }

  const reorderTabs = (targetId: string) => {
    if (!dragSessionId || dragSessionId === targetId) return
    setTabs((current) => {
      const from = current.findIndex((tab) => tab.summary.sessionId === dragSessionId)
      const to = current.findIndex((tab) => tab.summary.sessionId === targetId)
      if (from < 0 || to < 0) return current
      const reordered = [...current]
      const [moved] = reordered.splice(from, 1)
      reordered.splice(to, 0, moved!)
      return reordered
    })
    dragSessionId = null
    void persistWorkspace()
  }

  const respondPermission = (decision: ToolPermissionDecision) => {
    const pending = pendingPermission()
    if (!pending) return
    setPendingPermission(null)
    pending.resolve({ requestId: pending.request.requestId, decision })
  }

  const respondInput = (cancelInput = false) => {
    const pending = pendingInput()
    if (!pending) return
    setPendingInput(null)
    pending.resolve({
      requestId: pending.request.requestId,
      text: cancelInput ? undefined : inputReply(),
      cancelled: cancelInput,
    })
    setInputReply("")
  }

  const onComposerKeyDown: JSX.EventHandler<HTMLTextAreaElement, KeyboardEvent> = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void sendMessage()
    }
  }

  const onMarkdownClick: JSX.EventHandler<HTMLElement, MouseEvent> = (event) => {
    const anchor = (event.target as HTMLElement).closest("a")
    if (!anchor) return
    const href = anchor.getAttribute("href")
    if (!href) return
    event.preventDefault()
    if (/^https?:\/\//i.test(href)) void host?.openExternalUrl(href)
  }

  const openLocation = (path: string, line?: number) => {
    if (!offline()) void host?.openProjectFile(path, line ?? null)
  }

  const showDiff = (path: string) => {
    if (!offline()) void host?.showProjectDiff(path)
  }

  return (
    <main class="chat-app">
      <header class="session-bar">
        <div class="session-tabs" role="tablist">
          <For each={tabs()}>
            {(tab) => (
              <button
                class="session-tab"
                classList={{ active: tab.summary.sessionId === activeId() }}
                role="tab"
                title={tab.summary.title}
                draggable
                onDragStart={() => {
                  dragSessionId = tab.summary.sessionId
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => reorderTabs(tab.summary.sessionId)}
                onClick={() => void activate(tab.summary.sessionId)}
              >
                <StatusDot state={tab.summary.state} unread={tab.summary.unread} />
                <span class="session-title">{tab.summary.title}</span>
                <Show when={tab.summary.queuePosition}>
                  {(position) => <span class="queue-badge">{position()}</span>}
                </Show>
                <span
                  class="tab-close"
                  role="button"
                  title={t("关闭会话", "Close session")}
                  onClick={(event) => void closeSession(tab.summary.sessionId, event)}
                >
                  <X size={13} stroke-width={1.8} />
                </span>
              </button>
            )}
          </For>
        </div>
        <div class="session-actions">
          <button class="icon-button" title={t("新会话", "New session")} onClick={() => void newSession()}>
            <Plus size={17} />
          </button>
          <button class="icon-button" title={t("最近会话", "Recent sessions")} onClick={() => void refreshRecent()}>
            <History size={16} />
          </button>
          <span class="connection-dot" classList={{ ready: agentStatus() === "ready", offline: offline() }} title={`${hostStatus()} / ${agentStatus()}`} />
        </div>
        <Show when={recentOpen()}>
          <div class="recent-menu">
            <div class="recent-menu-title">{t("最近会话", "Recent sessions")}</div>
            <Show when={recent().length > 0} fallback={<div class="empty-menu">{t("暂无历史", "No recent sessions")}</div>}>
              <For each={recent()}>
                {(session) => (
                  <button class="recent-item" onClick={() => void openRecent(session)}>
                    <MessageSquareText size={14} />
                    <span>
                      <strong>{session.title}</strong>
                      <small>{new Date(session.updatedAt).toLocaleString()}</small>
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </header>

      <Show when={pendingPermission() && pendingPermission()!.request.sessionId !== activeId()}>
        <button class="attention-bar" onClick={() => void activate(pendingPermission()!.request.sessionId)}>
          <ShieldCheck size={15} />
          <span>{t("后台会话正在等待工具审批", "A background session needs tool approval")}</span>
          <span>{t("查看", "Open")}</span>
        </button>
      </Show>
      <Show when={pendingInput() && pendingInput()!.request.sessionId !== activeId()}>
        <button class="attention-bar" onClick={() => void activate(pendingInput()!.request.sessionId)}>
          <MessageSquareText size={15} />
          <span>{t("后台会话正在等待回复", "A background session is waiting for input")}</span>
          <span>{t("查看", "Open")}</span>
        </button>
      </Show>

      <section class="conversation" ref={conversationElement} onClick={onMarkdownClick}>
        <Show
          when={activeTab()}
          fallback={
            <div class="empty-state">
              <LoaderCircle class="spin" size={22} />
              <span>{t("正在载入会话", "Loading session")}</span>
            </div>
          }
        >
          {(tab) => (
            <div class="message-stream">
              <Show when={tab().messages.length === 0}>
                <div class="new-session-state">
                  <div class="new-session-mark"><Sparkles size={22} /></div>
                  <h1>{t("开始一个 Vibe Coding 会话", "Start a Vibe Coding session")}</h1>
                  <p>{modelLabel(tab().summary.modelId)}</p>
                </div>
              </Show>
              <For each={tab().messages}>{(message) => <MessageView message={message} openLocation={openLocation} showDiff={showDiff} zh={isZh} />}</For>

              <Show when={pendingPermission()?.request.sessionId === tab().summary.sessionId ? pendingPermission() : null}>
                {(pending) => (
                  <div class="interaction-card permission-card">
                    <div class="interaction-heading">
                      <ShieldCheck size={17} />
                      <span>{t("需要工具审批", "Tool approval required")}</span>
                    </div>
                    <strong>{pending().request.title}</strong>
                    <Show when={pending().request.command}>
                      {(command) => <pre class="permission-command">$ {command()}</pre>}
                    </Show>
                    <Show when={pending().request.locations?.length}>
                      <For each={pending().request.locations}>
                        {(location) => (
                          <button class="file-link" onClick={() => openLocation(location.path, location.line)}>
                            <FileCode2 size={13} /> {location.path}
                          </button>
                        )}
                      </For>
                    </Show>
                    <div class="permission-actions">
                      <button class="secondary-button" onClick={() => respondPermission("reject_once")}>{t("拒绝", "Reject")}</button>
                      <button class="secondary-button" onClick={() => respondPermission("reject_always")}>{t("本会话始终拒绝", "Always reject")}</button>
                      <button class="secondary-button" onClick={() => respondPermission("allow_always")}>{t("本会话始终允许", "Always allow")}</button>
                      <button class="primary-button" onClick={() => respondPermission("allow_once")}>{t("允许一次", "Allow once")}</button>
                    </div>
                  </div>
                )}
              </Show>

              <Show when={pendingInput()?.request.sessionId === tab().summary.sessionId ? pendingInput() : null}>
                {(pending) => (
                  <div class="interaction-card input-card">
                    <div class="interaction-heading">
                      <MessageSquareText size={17} />
                      <span>{t("Agent 需要你的回复", "Agent needs your input")}</span>
                    </div>
                    <p>{pending().request.prompt}</p>
                    <textarea
                      value={inputReply()}
                      placeholder={pending().request.placeholder}
                      onInput={(event) => setInputReply(event.currentTarget.value)}
                    />
                    <div class="permission-actions">
                      <button class="secondary-button" onClick={() => respondInput(true)}>{t("取消", "Cancel")}</button>
                      <button class="primary-button" onClick={() => respondInput(false)}>{t("提交", "Submit")}</button>
                    </div>
                  </div>
                )}
              </Show>
              <div />
            </div>
          )}
        </Show>
      </section>

      <Show when={error()}>
        {(message) => (
          <div class="error-banner">
            <AlertTriangle size={15} />
            <span>{message()}</span>
            <button class="icon-button" title={t("关闭", "Dismiss")} onClick={() => setError(null)}><X size={14} /></button>
          </div>
        )}
      </Show>

      <footer class="composer-shell">
        <Show when={activeContexts().length > 0}>
          <div class="context-list">
            <For each={activeContexts()}>
              {(context) => (
                <span class="context-chip" title={context.path}>
                  <FileCode2 size={13} />
                  <span>{context.path}</span>
                  <button
                    title={t("移除上下文", "Remove context")}
                    onClick={() =>
                      setContexts((current) => ({
                        ...current,
                        [activeId()]: (current[activeId()] ?? []).filter((item) => item.id !== context.id),
                      }))
                    }
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
            </For>
          </div>
        </Show>
        <textarea
          class="composer-input"
          value={activeDraft()}
          placeholder={t("输入消息...", "Type a message...")}
          onInput={(event) => setDraft(activeId(), event.currentTarget.value)}
          onKeyDown={onComposerKeyDown}
        />
        <div class="composer-toolbar">
          <div class="composer-selectors">
            <button class="toolbar-button" title={t("添加文件上下文", "Add file context")} disabled={offline()} onClick={() => void chooseContextFiles()}>
              <Paperclip size={15} />
            </button>
            <select
              aria-label={t("模型", "Model")}
              value={activeTab()?.summary.modelId ?? ""}
              disabled={isBusy() || isQueued() || offline()}
              onChange={(event) => void setModel(event.currentTarget.value)}
            >
              <Show when={(models()[activeId()] ?? []).length > 0} fallback={<option value={activeTab()?.summary.modelId ?? ""}>{modelLabel(activeTab()?.summary.modelId)}</option>}>
                <For each={models()[activeId()] ?? []}>{(option) => <option value={option.id}>{option.label}</option>}</For>
              </Show>
            </select>
            <select
              aria-label={t("思考级别", "Thinking level")}
              value={activeTab()?.summary.thinkingLevel ?? "off"}
              disabled={isBusy() || isQueued() || offline()}
              onChange={(event) => void setThinking(event.currentTarget.value)}
            >
              <option value="off">{t("关闭思考", "Thinking off")}</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">XHigh</option>
              <option value="auto">Auto</option>
            </select>
          </div>
          <div class="composer-actions">
            <button class="toolbar-button" title={t("更多", "More")}><MoreHorizontal size={16} /></button>
            <Show
              when={isBusy() || isQueued()}
              fallback={
                <button class="send-button" title={t("发送", "Send")} disabled={!activeDraft().trim()} onClick={() => void sendMessage()}>
                  <Send size={17} fill="currentColor" />
                </button>
              }
            >
              <button class="stop-button" title={isQueued() ? t("取消排队", "Cancel queued") : t("停止", "Stop")} onClick={() => void stopOrCancel()}>
                <CircleStop size={18} />
              </button>
            </Show>
          </div>
        </div>
      </footer>
    </main>
  )
}

function StatusDot(props: { state: ChatSessionSummary["state"]; unread: boolean }) {
  return (
    <span class="status-dot" classList={{ [props.state]: true, unread: props.unread }}>
      <Show when={props.state === "running"}><LoaderCircle size={12} class="spin" /></Show>
      <Show when={props.state === "queued"}><Clock3 size={11} /></Show>
      <Show when={props.state === "waiting_permission"}><ShieldCheck size={11} /></Show>
      <Show when={props.state === "waiting_input"}><MessageSquareText size={11} /></Show>
      <Show when={props.state === "error"}><AlertTriangle size={11} /></Show>
    </span>
  )
}

function MessageView(props: {
  message: ChatMessage
  openLocation: (path: string, line?: number) => void
  showDiff: (path: string) => void
  zh: boolean
}) {
  const [thinkingOpen, setThinkingOpen] = createSignal(true)
  const isUser = () => props.message.role === "user"
  return (
    <article class="chat-message" classList={{ user: isUser(), assistant: props.message.role === "assistant", system: props.message.role === "system" }}>
      <Show when={isUser()}>
        <div class="user-message-text">{textPart(props.message)}</div>
      </Show>
      <Show when={!isUser()}>
        <div class="assistant-gutter">
          <Show when={props.message.role === "assistant"} fallback={<AlertTriangle size={15} />}><Bot size={16} /></Show>
        </div>
        <div class="assistant-content">
          <For each={props.message.parts}>
            {(part) => (
              <Show
                when={part.kind !== "thinking"}
                fallback={
                  <div class="thinking-block" classList={{ open: thinkingOpen() }}>
                    <button class="thinking-toggle" onClick={() => setThinkingOpen((open) => !open)}>
                      <Brain size={15} />
                      <span>{props.zh ? "推理" : "Reasoning"}</span>
                      <ChevronDown size={14} />
                    </button>
                    <Show when={thinkingOpen()}>
                      <div class="thinking-content">{(part as Extract<ChatPart, { kind: "thinking" }>).text}</div>
                    </Show>
                  </div>
                }
              >
                <PartView part={part} openLocation={props.openLocation} showDiff={props.showDiff} />
              </Show>
            )}
          </For>
          <Show when={props.message.status === "streaming"}>
            <span class="streaming-caret" />
          </Show>
          <Show when={props.message.status === "error"}>
            <button class="retry-button"><RotateCcw size={13} /> {props.zh ? "重试" : "Retry"}</button>
          </Show>
        </div>
      </Show>
    </article>
  )
}

function PartView(props: { part: ChatPart; openLocation: (path: string, line?: number) => void; showDiff: (path: string) => void }) {
  return (
    <>
      <Show when={props.part.kind === "text"}>
        <div class="markdown-body" innerHTML={markdown((props.part as Extract<ChatPart, { kind: "text" }>).text)} />
      </Show>
      <Show when={props.part.kind === "notice"}>
        <div class="notice-part" classList={{ error: (props.part as Extract<ChatPart, { kind: "notice" }>).level === "error" }}>
          <AlertTriangle size={14} />
          {(props.part as Extract<ChatPart, { kind: "notice" }>).text}
        </div>
      </Show>
      <Show when={props.part.kind === "tool"}>
        <ToolPart part={props.part as Extract<ChatPart, { kind: "tool" }>} openLocation={props.openLocation} showDiff={props.showDiff} />
      </Show>
    </>
  )
}

function ToolPart(props: {
  part: Extract<ChatPart, { kind: "tool" }>
  openLocation: (path: string, line?: number) => void
  showDiff: (path: string) => void
}) {
  const [expanded, setExpanded] = createSignal(false)
  return (
    <div class="tool-part" classList={{ failed: props.part.status === "failed" }}>
      <button class="tool-summary" onClick={() => setExpanded((value) => !value)}>
        <span class="tool-icon">
          <Show when={props.part.status === "running"} fallback={<Show when={props.part.status === "failed"} fallback={<Check size={13} />}><AlertTriangle size={13} /></Show>}>
            <LoaderCircle size={13} class="spin" />
          </Show>
        </span>
        <Wrench size={14} />
        <strong>{props.part.name}</strong>
        <Show when={props.part.locations?.[0]}>
          {(location) => (
            <span
              class="tool-path"
              title={location().path}
              onClick={(event) => {
                event.stopPropagation()
                props.openLocation(location().path, location().line)
              }}
            >
              {location().path}
            </span>
          )}
        </Show>
        <Show when={props.part.output && !expanded()}>
          <span class="tool-result-short">{props.part.output!.split("\n", 1)[0]}</span>
        </Show>
        <Show when={(props.part.name === "edit" || props.part.name === "write") && props.part.locations?.[0]}>
          {(location) => (
            <span
              class="tool-diff"
              role="button"
              title="Show Diff"
              onClick={(event) => {
                event.stopPropagation()
                props.showDiff(location().path)
              }}
            >
              <GitCompareArrows size={13} />
            </span>
          )}
        </Show>
        <ChevronDown size={14} classList={{ rotated: expanded() }} />
      </button>
      <Show when={expanded()}>
        <div class="tool-detail">
          <Show when={props.part.input}><pre>{JSON.stringify(props.part.input, null, 2)}</pre></Show>
          <Show when={props.part.output}><pre>{props.part.output}</pre></Show>
        </div>
      </Show>
    </div>
  )
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
