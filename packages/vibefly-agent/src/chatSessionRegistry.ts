import * as fs from "node:fs"
import * as path from "node:path"
import {rpcOptions} from "@sandogeek/simple-rpc"
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionFactory,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent"
import type {AgentMessage} from "@earendil-works/pi-agent-core"
import type {Api, Model} from "@earendil-works/pi-ai"
import type {
  Agent2Ui,
  ChatContextItem,
  ChatEvent,
  ChatEventBatch,
  ChatFileLocation,
  ChatMessage,
  ChatModelOption,
  ChatPart,
  ChatSessionSnapshot,
  ChatSessionSummary,
  ListChatSessionsRequest,
  OpenChatSessionRequest,
  QueuedTurn,
  RecentChatSession,
  SendChatMessageRequest,
  SendChatMessageResult,
  ToolPermissionDecision,
} from "@vibefly/uiagent-shared"
import {log} from "./log.js"
import {getPiRuntime} from "./piRuntime.js"
import {SerialTurnScheduler} from "./chatScheduler.js"

type RuntimeSession = {
  session: AgentSession
  unsubscribe: () => void
}

type SettingsStorage = Parameters<typeof SettingsManager.fromStorage>[0]

export async function reloadSessionsIndependently(
    sessions: Iterable<{ sessionId: string; reload: () => Promise<void> }>,
    onReloaded: (sessionId: string) => void = () => {
    },
): Promise<void> {
  for (const session of sessions) {
    try {
      await session.reload()
      onReloaded(session.sessionId)
    } catch (error) {
      log.warn("chat session reload failed", {
        sessionId: session.sessionId,
        err: error,
      })
    }
  }
}

export function refreshSessionModelFromRuntime(
    session: Pick<
        AgentSession,
        "model" | "modelRuntime" | "setThinkingLevel" | "state" | "thinkingLevel"
    >,
): void {
  const current = session.model
  if (!current) return
  const refreshed = session.modelRuntime.getModel(current.provider, current.id)
  if (!refreshed || refreshed === current) return
  session.state.model = refreshed
  session.setThinkingLevel(session.thinkingLevel)
}

type SessionRecord = {
  summary: ChatSessionSummary
  projectRoot: string
  sessionFile?: string
  runtime?: RuntimeSession
  lastAccess: number
  sequence: number
  activeMessageId?: string
  toolLocations: Map<string, ChatFileLocation[]>
  approvedEditPaths: Map<string, number>
  permissionDecisions: Map<string, "allow_always" | "reject_always">
  writeDecision?: "allow_always" | "reject_always"
}

type PendingTurn = {
  turnId: string
  sessionId: string
  text: string
  contexts: ChatContextItem[]
  clientMessageId: string
  submittedAt: number
}

const MAX_RUNTIME_SESSIONS = 2
const MAX_RECENT_SESSIONS = 50
const MAX_DEDUPE_REQUESTS = 256
const EVENT_BATCH_WINDOW_MS = 24
const PERMISSION_RPC_OPTIONS = rpcOptions({ timeoutMs: 24 * 60 * 60 * 1000 })
const TOOL_NAMES = [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "edit",
  "write",
]
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"])
type ToolPermissionRequest = Parameters<Agent2Ui["requestToolPermission"]>[0]

function now(): number {
  return Date.now()
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function firstLine(value: string, fallback = "New session"): string {
  const title = value.split(/\r?\n/, 1)[0]?.trim().replace(/[\x00-\x1f\x7f]/g, "")
  if (!title) return fallback
  return title.length > 72 ? `${title.slice(0, 69)}...` : title
}

function normalizeProjectRoot(projectRoot: string): string {
  const resolved = path.resolve(projectRoot.trim())
  if (!path.isAbsolute(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Invalid project root: ${projectRoot}`)
  }
  return fs.realpathSync(resolved)
}

export function pathInsideProject(projectRoot: string, candidate: string): string {
  const normalizedRoot = fs.realpathSync(projectRoot)
  if (!candidate.trim() || path.isAbsolute(candidate)) {
    throw new Error(`Context path must be project-relative: ${candidate}`)
  }
  const absolute = path.resolve(normalizedRoot, candidate)
  const relative = path.relative(normalizedRoot, absolute)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Context path escapes the project: ${candidate}`)
  }
  let existing = absolute
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) {
    existing = path.dirname(existing)
  }
  if (fs.existsSync(existing)) {
    const realExisting = fs.realpathSync(existing)
    const unresolvedSuffix = path.relative(existing, absolute)
    const real = path.resolve(realExisting, unresolvedSuffix)
    const realRelative = path.relative(normalizedRoot, real)
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error(`Context path resolves outside the project: ${candidate}`)
    }
  }
  return absolute
}

function safeJson(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return ""
      const item = part as Record<string, unknown>
      if (item.type === "text") return typeof item.text === "string" ? item.text : ""
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function locationsFromArgs(args: unknown, projectRoot: string): ChatFileLocation[] | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined
  const values = args as Record<string, unknown>
  const candidates = [values.path, values.file, values.filePath]
  const locations: ChatFileLocation[] = []
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue
    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(projectRoot, candidate)
    const relative = path.relative(projectRoot, absolute)
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      locations.push({ path: relative || path.basename(absolute) })
    }
  }
  return locations.length > 0 ? locations : undefined
}

function messageParts(message: AgentMessage): ChatPart[] {
  const raw = message as unknown as Record<string, unknown>
  const content = raw.content
  if (typeof content === "string") return content ? [{ kind: "text", text: content }] : []
  if (!Array.isArray(content)) return []

  const parts: ChatPart[] = []
  for (const value of content) {
    if (!value || typeof value !== "object") continue
    const part = value as Record<string, unknown>
    if (part.type === "text" && typeof part.text === "string") {
      parts.push({ kind: "text", text: part.text })
    } else if (part.type === "thinking" && typeof part.thinking === "string") {
      parts.push({ kind: "thinking", text: part.thinking })
    } else if (part.type === "toolCall") {
      parts.push({
        kind: "tool",
        toolCallId: String(part.id ?? makeId("tool")),
        name: String(part.name ?? "tool"),
        status: "completed",
        input: part.arguments,
      })
    }
  }
  return parts
}

function messageStatus(message: AgentMessage): ChatMessage["status"] {
  const raw = message as unknown as Record<string, unknown>
  if (raw.stopReason === "aborted") return "aborted"
  if (raw.stopReason === "error" || raw.errorMessage) return "error"
  return "complete"
}

function toChatMessages(messages: AgentMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  const toolParts = new Map<string, Extract<ChatPart, { kind: "tool" }>>()

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index] as unknown as Record<string, unknown>
    if (message.role === "toolResult") {
      const toolCallId = String(message.toolCallId ?? "")
      const tool = toolParts.get(toolCallId)
      if (tool) {
        tool.output = textFromContent(message.content)
        tool.status = message.isError ? "failed" : "completed"
        tool.isError = Boolean(message.isError)
      }
      continue
    }
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "developer") continue
    const parts = messageParts(messages[index]!)
    const chatMessage: ChatMessage = {
      id: String(message.id ?? `history-${index}`),
      role: message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : "system",
      parts,
      createdAt: typeof message.timestamp === "number" ? message.timestamp : now(),
      status: messageStatus(messages[index]!),
    }
    for (const part of parts) {
      if (part.kind === "tool") toolParts.set(part.toolCallId, part)
    }
    result.push(chatMessage)
  }
  return result
}

function formatPrompt(text: string, contexts: ChatContextItem[], projectRoot: string): string {
  if (contexts.length === 0) return text
  const blocks = contexts.map((context) => {
    pathInsideProject(projectRoot, context.path)
    if (context.kind === "selection") {
      const selection = (context.text ?? "").slice(0, 256 * 1024)
      const lines = context.startLine
        ? ` lines ${context.startLine}${context.endLine && context.endLine !== context.startLine ? `-${context.endLine}` : ""}`
        : ""
      return `<selection path="${context.path}"${lines}>\n${selection}\n</selection>`
    }
    return `<file path="${context.path}" />`
  })
  return `${text}\n\n<context>\n${blocks.join("\n")}\n</context>`
}

const FILE_TOOLS = new Set(["read", "grep", "glob", "ast_grep", "edit", "write"])

function pathCandidates(toolName: string, input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return []
  const values = input as Record<string, unknown>
  const candidates: string[] = []
  for (const key of [
    "path",
    "file",
    "filePath",
    "file_path",
    "paths",
    "files",
    "rename",
    "destination",
    "newPath",
  ]) {
    const value = values[key]
    if (typeof value === "string") candidates.push(...value.split(";"))
    if (Array.isArray(value)) candidates.push(...value.filter((item): item is string => typeof item === "string"))
  }
  if (toolName === "edit") {
    const edits = Array.isArray(values.edits) ? values.edits : []
    for (const edit of edits) {
      if (!edit || typeof edit !== "object" || Array.isArray(edit)) continue
      const rename = (edit as Record<string, unknown>).rename
      if (typeof rename === "string") candidates.push(rename)
    }
    if (typeof values.input === "string") {
      for (const match of values.input.matchAll(/^\[([^#\r\n]+)(?:#[0-9a-fA-F]{4})?]/gm)) {
        if (match[1]) candidates.push(match[1])
      }
      for (const match of values.input.matchAll(/^\*\*\* (?:Add|Update|Delete|Move to) File:\s*(.+)$/gm)) {
        if (match[1]) candidates.push(match[1])
      }
      for (const match of values.input.matchAll(/^\*\*\* Move to:\s*(.+)$/gm)) {
        if (match[1]) candidates.push(match[1])
      }
    }
  }
  return candidates
    .flatMap((value) => value.split(";"))
    .map((value) => value.trim())
    .filter(Boolean)
}

export function validateToolPaths(projectRoot: string, toolName: string, input: unknown): void {
  for (const candidate of pathCandidates(toolName, input)) {
    if (/^(?:https?|memory|skill):\/\//i.test(candidate)) continue
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
      throw new Error(`File URI is outside the project workspace: ${candidate}`)
    }
    pathInsideProject(projectRoot, candidate)
  }
}

function createPathGuardExtension(
  projectRoot: string,
  requestPermission: (request: ToolPermissionRequest) => Promise<ToolPermissionDecision>,
): ExtensionFactory {
  return (api) => {
    api.on("tool_call", async (event, context) => {
      if (FILE_TOOLS.has(event.toolName)) {
        try {
          validateToolPaths(projectRoot, event.toolName, event.input)
        } catch (error) {
          return { block: true, reason: errorMessage(error) }
        }
      }
      if (event.toolName !== "bash" && event.toolName !== "edit" && event.toolName !== "write") {
        return undefined
      }
      if (!context.hasUI) {
        return { block: true, reason: "Tool requires approval, but no UI is available" }
      }
      const command = event.toolName === "bash"
        ? String((event.input as Record<string, unknown>).command ?? "")
        : undefined
      const locations = locationsFromArgs(event.input, projectRoot)
      const title = event.toolName === "bash"
        ? `Run ${command}`
        : event.toolName === "edit"
          ? `Edit ${locations?.map((location) => location.path).join(", ") || "project files"}`
          : `Write ${locations?.map((location) => location.path).join(", ") || "project files"}`
      const decision = await requestPermission({
        requestId: makeId("permission"),
        sessionId: context.sessionManager.getSessionId(),
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        title,
        command,
        cwd: projectRoot,
        input: event.input,
        locations,
      })
      if (decision === "allow_once" || decision === "allow_always") return undefined
      return { block: true, reason: decision === "cancelled" ? "Cancelled by user" : "Blocked by user" }
    })
  }
}

function sessionDirFor(projectRoot: string, agentDir: string): string {
  const resolvedRoot = path.resolve(projectRoot)
  const safePath = `--${resolvedRoot.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`
  const sessionDir = path.join(agentDir, "sessions", safePath)
  fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 })
  return sessionDir
}

export class ChatSessionRegistry {
  readonly #records = new Map<string, SessionRecord>()
  readonly #scheduler = new SerialTurnScheduler<PendingTurn>()
  readonly #dedupe = new Map<string, SendChatMessageResult>()
  readonly #pendingEvents = new Map<string, ChatEvent[]>()
  readonly #eventTimers = new Map<string, ReturnType<typeof setTimeout>>()
  #sink: Agent2Ui | undefined
  #projectRoot: string | undefined
  #disposed = false

  constructor(
      expectedProjectRoot?: string,
      private readonly defaultModelId?: string,
      private readonly options: { settingsStorage?: SettingsStorage } = {},
  ) {
    if (expectedProjectRoot?.trim()) this.#projectRoot = normalizeProjectRoot(expectedProjectRoot)
  }

  attach(sink: Agent2Ui): void {
    this.#sink = sink
  }

  async disconnect(): Promise<void> {
    this.#sink = undefined
    this.#scheduler.clearQueued()
    this.#emitQueue()
    if (this.#scheduler.active) {
      const record = this.#records.get(this.#scheduler.active.sessionId)
      if (record?.runtime) {
        await record.runtime.session.abort().catch(() => {})
      }
    }
    for (const record of this.#records.values()) {
      if (record.summary.state === "queued") {
        record.summary.state = "idle"
        record.summary.queuePosition = undefined
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    await this.disconnect()
    for (const timer of this.#eventTimers.values()) clearTimeout(timer)
    this.#eventTimers.clear()
    for (const record of this.#records.values()) await this.#disposeRuntime(record)
    this.#records.clear()
  }

  async reloadLiveSessions(modelCatalogChanged = false): Promise<void> {
    const records = [...this.#records.values()].filter(
        (record): record is SessionRecord & { runtime: RuntimeSession } => Boolean(record.runtime),
    )
    const byId = new Map(records.map((record) => [record.summary.sessionId, record]))
    await reloadSessionsIndependently(
        records.map((record) => ({
          sessionId: record.summary.sessionId,
          reload: async () => {
            refreshSessionModelFromRuntime(record.runtime.session)
            await record.runtime.session.reload()
          },
        })),
        (sessionId) => {
          const record = byId.get(sessionId)
          if (!record) return
          this.#syncSummaryFromRuntime(record)
          this.#emitSummary(record)
          if (modelCatalogChanged) {
            this.#emit(record, {
              kind: "modelCatalogChanged",
              sessionId: record.summary.sessionId,
            })
          }
        },
    )
  }

  async listChatSessions(request: ListChatSessionsRequest): Promise<ChatSessionSummary[]> {
    this.#ensureProject(request.projectRoot)
    return [...this.#records.values()]
      .sort((a, b) => a.lastAccess - b.lastAccess)
      .map((record) => ({ ...record.summary }))
  }

  async listRecentChatSessions(request: ListChatSessionsRequest): Promise<RecentChatSession[]> {
    const projectRoot = this.#ensureProject(request.projectRoot)
    const runtime = await getPiRuntime()
    const sessionDir = sessionDirFor(projectRoot, runtime.agentDir)
    const sessions = await SessionManager.list(projectRoot, sessionDir)
    return sessions
      .sort((a, b) => b.modified.getTime() - a.modified.getTime())
      .slice(0, MAX_RECENT_SESSIONS)
      .map((session) => ({
        sessionId: session.id,
        title: firstLine(session.name || session.firstMessage),
        sessionFile: session.path,
        updatedAt: session.modified.getTime(),
        messageCount: session.messageCount,
        status: undefined,
      }))
  }

  async openChatSession(request: OpenChatSessionRequest): Promise<ChatSessionSnapshot> {
    const projectRoot = this.#ensureProject(request.projectRoot)
    if (request.sessionId) {
      const existing = this.#records.get(request.sessionId)
      if (existing) {
        existing.lastAccess = now()
        await this.#ensureRuntime(existing)
        return this.#snapshot(existing)
      }
    }

    let sessionFile = request.sessionFile
    if (!sessionFile && request.sessionId) {
      const recent = await this.listRecentChatSessions({ projectRoot })
      sessionFile = recent.find((session) => session.sessionId === request.sessionId)?.sessionFile
    }
    if (!sessionFile || !fs.existsSync(sessionFile)) {
      throw new Error("The selected pi session no longer exists")
    }

    const runtime = await getPiRuntime()
    const manager = await SessionManager.open(
      sessionFile,
      sessionDirFor(projectRoot, runtime.agentDir),
      projectRoot,
    )
    const sessionId = manager.getSessionId()
    const duplicate = this.#records.get(sessionId)
    if (duplicate) {
      duplicate.lastAccess = now()
      await this.#ensureRuntime(duplicate)
      return this.#snapshot(duplicate)
    }

    const record = this.#newRecord(projectRoot, manager, sessionFile)
    this.#records.set(sessionId, record)
    await this.#createRuntime(record, manager)
    await this.#evictRuntime(record.summary.sessionId)
    return this.#snapshot(record)
  }

  async createChatSession(request: ListChatSessionsRequest): Promise<ChatSessionSnapshot> {
    const projectRoot = this.#ensureProject(request.projectRoot)
    const runtime = await getPiRuntime()
    const sessionDir = sessionDirFor(projectRoot, runtime.agentDir)
    const manager = SessionManager.create(projectRoot, sessionDir)
    const record = this.#newRecord(projectRoot, manager, manager.getSessionFile())
    this.#records.set(record.summary.sessionId, record)
    await this.#createRuntime(record, manager)
    await this.#evictRuntime(record.summary.sessionId)
    this.#emit(record, { kind: "snapshot", snapshot: this.#snapshot(record) })
    return this.#snapshot(record)
  }

  async releaseChatSession(sessionId: string): Promise<void> {
    const record = this.#requiredRecord(sessionId)
    if (this.#scheduler.active?.sessionId === sessionId) {
      throw new Error("Abort the running turn before closing this session")
    }
    this.cancelQueuedTurn(sessionId)
    await this.#disposeRuntime(record)
    this.#records.delete(sessionId)
    this.#emit(record, { kind: "sessionReleased", sessionId })
  }

  sendChatMessage(request: SendChatMessageRequest): SendChatMessageResult {
    const record = this.#requiredRecord(request.sessionId)
    const text = request.text.trim()
    if (!text) throw new Error("Message cannot be empty")
    const duplicate = this.#dedupe.get(request.clientMessageId)
    if (duplicate) return { ...duplicate }
    if (this.#scheduler.queued.some((turn) => turn.sessionId === request.sessionId)) {
      throw new Error("This session already has a queued message")
    }
    if (this.#scheduler.active?.sessionId === request.sessionId) {
      throw new Error("Wait for the current turn to finish or stop it first")
    }

    const turn: PendingTurn = {
      turnId: makeId("turn"),
      sessionId: request.sessionId,
      text,
      contexts: request.contexts ?? [],
      clientMessageId: request.clientMessageId,
      submittedAt: now(),
    }
    const queuedState = this.#scheduler.enqueue(turn)
    const queued = !queuedState.immediate
    record.summary.state = queued ? "queued" : "running"
    record.summary.updatedAt = now()
    record.summary.queuePosition = queued ? queuedState.position : undefined
    record.lastAccess = now()

    const userMessage: ChatMessage = {
      id: makeId("user"),
      role: "user",
      parts: [{ kind: "text", text }],
      createdAt: turn.submittedAt,
      status: "complete",
    }
    this.#emit(record, { kind: "message", sessionId: request.sessionId, message: userMessage })
    this.#emitSummary(record)
    this.#emitQueue()

    const result: SendChatMessageResult = queued
      ? { turnId: turn.turnId, state: "queued", queuePosition: queuedState.position }
      : { turnId: turn.turnId, state: "running" }
    this.#rememberDedupe(request.clientMessageId, result)
    void this.#drainQueue()
    return result
  }

  cancelQueuedTurn(sessionId: string): void {
    if (!this.#scheduler.cancelQueuedForSession(sessionId)) return
    const record = this.#records.get(sessionId)
    if (record) {
      record.summary.state = "idle"
      record.summary.queuePosition = undefined
      this.#emitSummary(record)
    }
    this.#updateQueuePositions()
    this.#emitQueue()
  }

  async abortChatTurn(sessionId: string): Promise<void> {
    if (this.#scheduler.active?.sessionId !== sessionId) {
      this.cancelQueuedTurn(sessionId)
      return
    }
    const record = this.#requiredRecord(sessionId)
    const session = record.runtime?.session
    if (!session) return
    await session.abort()
    await session.waitForIdle().catch(() => {})
  }

  async listChatModels(sessionId: string): Promise<ChatModelOption[]> {
    const record = this.#requiredRecord(sessionId)
    await this.#ensureRuntime(record)
    const models = await record.runtime!.session.modelRuntime.getAvailable()
    return models.map(toModelOption)
  }

  async setChatModel(sessionId: string, modelId: string): Promise<ChatSessionSummary> {
    const record = this.#requiredMutableRecord(sessionId)
    await this.#ensureRuntime(record)
    const session = record.runtime!.session
    const models = await session.modelRuntime.getAvailable()
    const model = models.find((candidate) => modelKey(candidate) === modelId)
    if (!model) throw new Error(`Model is not available: ${modelId}`)
    await session.setModel(model)
    this.#syncSummaryFromRuntime(record)
    this.#emitSummary(record)
    return { ...record.summary }
  }

  async setChatThinkingLevel(sessionId: string, level: string): Promise<ChatSessionSummary> {
    const record = this.#requiredMutableRecord(sessionId)
    if (!THINKING_LEVELS.has(level)) throw new Error(`Invalid thinking level: ${level}`)
    await this.#ensureRuntime(record)
    record.runtime!.session.setThinkingLevel(level as never)
    this.#syncSummaryFromRuntime(record)
    this.#emitSummary(record)
    return { ...record.summary }
  }

  markChatSessionRead(sessionId: string): void {
    const record = this.#requiredRecord(sessionId)
    if (!record.summary.unread) return
    record.summary.unread = false
    this.#emitSummary(record)
  }

  #ensureProject(value: string): string {
    const projectRoot = normalizeProjectRoot(value)
    if (this.#projectRoot && this.#projectRoot !== projectRoot) {
      throw new Error(`Agent is already bound to project ${this.#projectRoot}`)
    }
    this.#projectRoot = projectRoot
    return projectRoot
  }

  #newRecord(projectRoot: string, manager: SessionManager, sessionFile?: string): SessionRecord {
    const modified = sessionFile && fs.existsSync(sessionFile) ? fs.statSync(sessionFile).mtimeMs : now()
    return {
      projectRoot,
      sessionFile,
      lastAccess: now(),
      sequence: 0,
      toolLocations: new Map(),
      approvedEditPaths: new Map(),
      permissionDecisions: new Map(),
      summary: {
        sessionId: manager.getSessionId(),
        title: firstLine(manager.getSessionName() ?? ""),
        sessionFile,
        state: "idle",
        unread: false,
        updatedAt: modified,
        messageCount: manager.getBranch().filter((entry) => entry.type === "message").length,
      },
    }
  }

  async #createRuntime(record: SessionRecord, manager: SessionManager): Promise<void> {
    const piRuntime = await getPiRuntime()
    const initialModel = manager.getBranch().length === 0
      ? resolveModel(piRuntime.registry, this.defaultModelId)
      : undefined
    const settingsManager = this.options.settingsStorage
        ? SettingsManager.fromStorage(this.options.settingsStorage)
        : SettingsManager.inMemory()
    const resourceLoader = new DefaultResourceLoader({
      cwd: record.projectRoot,
      agentDir: piRuntime.agentDir,
      settingsManager,
      noExtensions: true,
      extensionFactories: [
        createPathGuardExtension(
          record.projectRoot,
          (request) => this.#requestPermission(record, request),
        ),
      ],
    })
    await resourceLoader.reload()
    const created = await createAgentSession({
      cwd: record.projectRoot,
      agentDir: piRuntime.agentDir,
      modelRuntime: piRuntime.modelRuntime,
      model: initialModel,
      sessionManager: manager,
      settingsManager,
      resourceLoader,
      tools: TOOL_NAMES,
    })
    const runtime: RuntimeSession = {
      session: created.session,
      unsubscribe: () => {},
    }
    record.runtime = runtime
    runtime.unsubscribe = created.session.subscribe((event) => this.#onSessionEvent(record, event))
    await created.session.bindExtensions({
      uiContext: this.#createExtensionUi(record) as never,
      mode: "rpc",
    })
    record.sessionFile = created.session.sessionFile
    this.#syncSummaryFromRuntime(record)
  }

  async #ensureRuntime(record: SessionRecord): Promise<void> {
    record.lastAccess = now()
    if (record.runtime) return
    if (!record.sessionFile || !fs.existsSync(record.sessionFile)) {
      throw new Error("The pi session file was removed or is unavailable")
    }
    const runtime = await getPiRuntime()
    const manager = await SessionManager.open(
      record.sessionFile,
      sessionDirFor(record.projectRoot, runtime.agentDir),
      record.projectRoot,
    )
    await this.#createRuntime(record, manager)
    await this.#evictRuntime(record.summary.sessionId)
  }

  async #disposeRuntime(record: SessionRecord): Promise<void> {
    const runtime = record.runtime
    if (!runtime) return
    record.runtime = undefined
    runtime.unsubscribe()
    runtime.session.dispose()
    await Promise.resolve().catch((error) => {
      log.warn("chat session dispose failed", { sessionId: record.summary.sessionId, err: error })
    })
  }

  async #evictRuntime(keepSessionId: string): Promise<void> {
    const live = [...this.#records.values()].filter((record) => record.runtime)
    if (live.length <= MAX_RUNTIME_SESSIONS) return
    const candidate = live
      .filter(
        (record) =>
          record.summary.sessionId !== keepSessionId &&
          record.summary.sessionId !== this.#scheduler.active?.sessionId &&
          record.summary.state !== "running" &&
          record.summary.state !== "waiting_permission" &&
          record.summary.state !== "waiting_input",
      )
      .sort((a, b) => a.lastAccess - b.lastAccess)[0]
    if (candidate) await this.#disposeRuntime(candidate)
  }

  #snapshot(record: SessionRecord): ChatSessionSnapshot {
    const messages = record.runtime ? toChatMessages(record.runtime.session.messages) : []
    record.summary.messageCount = messages.length
    return { summary: { ...record.summary }, messages }
  }

  #syncSummaryFromRuntime(record: SessionRecord): void {
    const session = record.runtime?.session
    if (!session) return
    record.sessionFile = session.sessionFile
    record.summary.sessionFile = session.sessionFile
    record.summary.title = firstLine(session.sessionName ?? record.summary.title)
    record.summary.modelId = session.model ? modelKey(session.model) : undefined
    record.summary.thinkingLevel = session.thinkingLevel ?? "off"
    record.summary.messageCount = toChatMessages(session.messages).length
    record.summary.updatedAt = now()
  }

  #requiredRecord(sessionId: string): SessionRecord {
    const record = this.#records.get(sessionId)
    if (!record) throw new Error(`Chat session is not open: ${sessionId}`)
    return record
  }

  #requiredMutableRecord(sessionId: string): SessionRecord {
    const record = this.#requiredRecord(sessionId)
    if (record.summary.state === "running" || record.summary.state === "queued" || this.#scheduler.active?.sessionId === sessionId) {
      throw new Error("Model and thinking settings cannot change while a turn is running or queued")
    }
    return record
  }

  #rememberDedupe(clientMessageId: string, result: SendChatMessageResult): void {
    this.#dedupe.set(clientMessageId, result)
    while (this.#dedupe.size > MAX_DEDUPE_REQUESTS) {
      const oldest = this.#dedupe.keys().next().value
      if (oldest === undefined) break
      this.#dedupe.delete(oldest)
    }
  }

  async #drainQueue(): Promise<void> {
    if (this.#scheduler.active || this.#disposed) return
    const turn = this.#scheduler.startNext()
    if (!turn) return
    const record = this.#records.get(turn.sessionId)
    if (!record) {
      this.#scheduler.finish(turn)
      void this.#drainQueue()
      return
    }
    record.summary.state = "running"
    record.summary.queuePosition = undefined
    this.#updateQueuePositions()
    this.#emitSummary(record)
    this.#emitQueue()

    let ok = false
    let aborted = false
    let failure: string | undefined
    try {
      await this.#ensureRuntime(record)
      const runtime = record.runtime!
      const prompt = formatPrompt(turn.text, turn.contexts, record.projectRoot)
      if (record.summary.title === "New session") {
        const title = firstLine(turn.text)
        runtime.session.setSessionName(title)
        record.summary.title = title
      }
      await runtime.session.prompt(prompt, { source: "rpc" })
      await runtime.session.waitForIdle()
      ok = true
      record.summary.state = "completed"
    } catch (error) {
      failure = errorMessage(error)
      aborted = /abort|stopped|interrupt/i.test(failure)
      record.summary.state = aborted ? "idle" : "error"
      log.warn("chat turn failed", { sessionId: turn.sessionId, turnId: turn.turnId, err: error })
    } finally {
      this.#syncSummaryFromRuntime(record)
      record.summary.unread = true
      this.#emit(record, {
        kind: "turnComplete",
        sessionId: turn.sessionId,
        turnId: turn.turnId,
        ok,
        aborted: aborted || undefined,
        error: failure,
      })
      this.#emitSummary(record)
      this.#scheduler.finish(turn)
      void this.#evictRuntime(turn.sessionId)
      void this.#drainQueue()
    }
  }

  #updateQueuePositions(): void {
    this.#scheduler.queued.forEach((turn, index) => {
      const record = this.#records.get(turn.sessionId)
      if (!record) return
      record.summary.state = "queued"
      record.summary.queuePosition = index + 1
      this.#emitSummary(record)
    })
  }

  #queuedTurns(): QueuedTurn[] {
    return this.#scheduler.queued.map((turn, index) => ({
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      text: turn.text,
      submittedAt: turn.submittedAt,
      position: index + 1,
    }))
  }

  #emitQueue(): void {
    const record = this.#scheduler.active
      ? this.#records.get(this.#scheduler.active.sessionId)
      : this.#records.values().next().value as SessionRecord | undefined
    if (record) this.#emit(record, { kind: "queue", turns: this.#queuedTurns() })
  }

  #emitSummary(record: SessionRecord): void {
    this.#emit(record, { kind: "summary", summary: { ...record.summary } })
  }

  #emit(record: SessionRecord, event: ChatEvent): void {
    const sessionId = record.summary.sessionId
    const events = this.#pendingEvents.get(sessionId) ?? []
    events.push(event)
    this.#pendingEvents.set(sessionId, events)
    if (this.#eventTimers.has(sessionId)) return
    const timer = setTimeout(() => this.#flushEvents(record), EVENT_BATCH_WINDOW_MS)
    this.#eventTimers.set(sessionId, timer)
  }

  #flushEvents(record: SessionRecord): void {
    const sessionId = record.summary.sessionId
    this.#eventTimers.delete(sessionId)
    const events = this.#pendingEvents.get(sessionId)
    this.#pendingEvents.delete(sessionId)
    if (!events?.length || !this.#sink) return
    record.sequence += 1
    const batch: ChatEventBatch = { sessionId, sequence: record.sequence, events }
    void this.#sink.onChatEvents(batch).catch((error) => {
      log.debug("onChatEvents delivery failed", { sessionId, err: error })
    })
  }

  #onSessionEvent(record: SessionRecord, event: AgentSessionEvent): void {
    if (event.type === "agent_start") {
      record.activeMessageId = makeId("assistant")
      const message: ChatMessage = {
        id: record.activeMessageId,
        role: "assistant",
        parts: [],
        createdAt: now(),
        status: "streaming",
      }
      this.#emit(record, { kind: "message", sessionId: record.summary.sessionId, message })
      return
    }
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent
      if (update.type !== "text_delta" && update.type !== "thinking_delta") return
      if (!record.activeMessageId) record.activeMessageId = makeId("assistant")
      this.#emit(record, {
        kind: "partDelta",
        sessionId: record.summary.sessionId,
        messageId: record.activeMessageId,
        partKind: update.type === "text_delta" ? "text" : "thinking",
        delta: update.delta,
      })
      return
    }
    if (event.type === "tool_execution_start") {
      if (!record.activeMessageId) record.activeMessageId = makeId("assistant")
      const locations = locationsFromArgs(event.args, record.projectRoot)
      if (locations) record.toolLocations.set(event.toolCallId, locations)
      this.#emit(record, {
        kind: "tool",
        sessionId: record.summary.sessionId,
        messageId: record.activeMessageId,
        part: {
          kind: "tool",
          toolCallId: event.toolCallId,
          name: event.toolName,
          status: "running",
          input: event.args,
          locations,
        },
      })
      return
    }
    if (event.type === "tool_execution_end") {
      if (!record.activeMessageId) return
      const locations = record.toolLocations.get(event.toolCallId)
      record.toolLocations.delete(event.toolCallId)
      this.#emit(record, {
        kind: "tool",
        sessionId: record.summary.sessionId,
        messageId: record.activeMessageId,
        part: {
          kind: "tool",
          toolCallId: event.toolCallId,
          name: event.toolName,
          status: event.isError ? "failed" : "completed",
          output: safeJson(event.result),
          isError: event.isError,
          locations,
        },
      })
      return
    }
    if (event.type === "message_end" && (event.message as unknown as { role?: string }).role === "assistant") {
      if (!record.activeMessageId) return
      this.#emit(record, {
        kind: "messageStatus",
        sessionId: record.summary.sessionId,
        messageId: record.activeMessageId,
        status: messageStatus(event.message),
      })
      return
    }
    if (event.type === "agent_end") {
      record.activeMessageId = undefined
      return
    }
    if (event.type === "thinking_level_changed") {
      this.#syncSummaryFromRuntime(record)
      this.#emitSummary(record)
    }
  }

  async #requestPermission(
    record: SessionRecord,
    request: ToolPermissionRequest,
  ): Promise<ToolPermissionDecision> {
    if (!this.#sink) return "cancelled"
    const permissionKey = clientPermissionKey(request.toolName, request.title)
    const remembered = record.permissionDecisions.get(permissionKey)
    if (remembered) return remembered === "reject_always" ? "reject_always" : remembered
    const previous = record.summary.state
    record.summary.state = "waiting_permission"
    this.#emitSummary(record)
    try {
      const response = await this.#sink.requestToolPermission(request, PERMISSION_RPC_OPTIONS)
      const decision = response.requestId === request.requestId ? response.decision : "cancelled"
      if (decision === "allow_always" || decision === "reject_always") {
        record.permissionDecisions.set(permissionKey, decision)
      }
      return decision
    } finally {
      record.summary.state = previous === "waiting_permission" ? "running" : previous
      this.#emitSummary(record)
    }
  }

  #createExtensionUi(record: SessionRecord) {
    const ask = async (prompt: string, placeholder?: string): Promise<string | undefined> => {
      if (!this.#sink) return undefined
      const requestId = makeId("input")
      const previous = record.summary.state
      record.summary.state = "waiting_input"
      this.#emitSummary(record)
      try {
        const response = await this.#sink.requestUserInput(
          { requestId, sessionId: record.summary.sessionId, prompt, placeholder },
          PERMISSION_RPC_OPTIONS,
        )
        return response.cancelled || response.requestId !== requestId ? undefined : response.text
      } finally {
        record.summary.state = previous === "waiting_input" ? "running" : previous
        this.#emitSummary(record)
      }
    }

    return {
      select: async (title: string, options: string[]) => {
        const response = await ask(`${title}\n${options.map((option, index) => `${index + 1}. ${option}`).join("\n")}`)
        const index = Number.parseInt(response ?? "", 10) - 1
        return Number.isInteger(index) && index >= 0 && index < options.length
          ? options[index]
          : response
      },
      confirm: async (title: string, message: string) => {
        const response = await ask(`${title}\n${message}\n[y/N]`)
        return /^y(?:es)?$/i.test(response ?? "")
      },
      input: ask,
      editor: ask,
      notify: (message: string, level: "info" | "warning" | "error" = "info") => {
        const assistantId = record.activeMessageId ?? makeId("notice")
        this.#emit(record, {
          kind: "message",
          sessionId: record.summary.sessionId,
          message: {
            id: assistantId,
            role: "system",
            parts: [{ kind: "notice", level, text: message }],
            createdAt: now(),
            status: "complete",
          },
        })
      },
      onTerminalInput: () => () => {},
      setStatus: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: () => {},
      setFooter: () => {},
      setHeader: () => {},
      setTitle: () => {},
      custom: async () => undefined,
      setEditorText: () => {},
      pasteToEditor: () => {},
      getEditorText: () => "",
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      theme: undefined,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme selection is unavailable" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    }
  }
}

function modelKey(model: Pick<Model<Api>, "provider" | "id">): string {
  return `${model.provider}/${model.id}`
}

function clientPermissionKey(toolName: string, title: string): string {
  if (toolName === "edit" && /^delete\b/i.test(title)) return "edit:delete"
  if (toolName === "edit" && /^move\b/i.test(title)) return "edit:move"
  return toolName
}

function toModelOption(model: Model<Api>): ChatModelOption {
  return {
    id: modelKey(model),
    provider: model.provider,
    model: model.id,
    label: model.name || model.id,
    supportsThinking: Boolean(model.reasoning),
  }
}

function resolveModel(
  registry: { find(provider: string, id: string): Model<Api> | undefined },
  modelId: string | undefined,
): Model<Api> | undefined {
  const spec = modelId?.trim()
  if (!spec) return undefined
  const slash = spec.indexOf("/")
  if (slash <= 0 || slash === spec.length - 1) return undefined
  return registry.find(spec.slice(0, slash), spec.slice(slash + 1))
}
