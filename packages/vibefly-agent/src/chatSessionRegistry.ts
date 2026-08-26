import * as fs from "node:fs"
import {rpcOptions} from "@sandogeek/simple-rpc"
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent"
import type {
  Agent2Ui,
  ChatContextItem,
  ChatEvent,
  ChatEventBatch,
  ChatFileLocation,
  ChatMessage,
  ChatModelOption,
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
import {clientPermissionKey, mapSessionEvent, toChatMessages} from "./chat/eventMapper.js"
import {
  THINKING_DURATION_CUSTOM_TYPE,
  ThinkingDurationClock,
  noteThinkingDurationEvent,
  recordsFromBranch,
  type ThinkingDurationData,
} from "./chat/thinkingDuration.js"
import {
  modelKey,
  refreshSessionModelFromRuntime,
  resolveModel,
  THINKING_LEVELS,
  toModelOption,
} from "./chat/modelResolution.js"
import {
  errorMessage,
  firstLine,
  formatPrompt,
  makeId,
  normalizeProjectRoot,
  now,
  reloadSessionsIndependently,
  sessionDirFor,
} from "./chat/sessionLifecycle.js"
import {createPathGuardExtension, pathInsideProject, validateToolPaths} from "./chat/toolPathGuard.js"

export {pathInsideProject, validateToolPaths} from "./chat/toolPathGuard.js"
export {refreshSessionModelFromRuntime} from "./chat/modelResolution.js"
export {reloadSessionsIndependently} from "./chat/sessionLifecycle.js"

type RuntimeSession = {
  session: AgentSession
  unsubscribe: () => void
}

type SettingsStorage = Parameters<typeof SettingsManager.fromStorage>[0]

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
  thinkingClock: ThinkingDurationClock
  /** Last user prompt, used to retry a turn that failed before landing in pi. */
  lastPrompt?: {text: string; contexts: ChatContextItem[]}
}

type PendingTurn = {
  turnId: string
  sessionId: string
  text: string
  contexts: ChatContextItem[]
  clientMessageId: string
  submittedAt: number
  kind: "prompt" | "retry"
}

const MAX_RUNTIME_SESSIONS = 2
const MAX_RECENT_SESSIONS = 50
const MAX_DEDUPE_REQUESTS = 256
const EVENT_BATCH_WINDOW_MS = 24
const PERMISSION_RPC_OPTIONS = rpcOptions({timeoutMs: 24 * 60 * 60 * 1000})
/** Hidden custom message that convertToLlm turns into a user continue instruction. */
const RETRY_TURN_PROMPT =
  "The previous turn failed. Continue the user's last request from where you left off."
const TOOL_NAMES = [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "edit",
  "write",
]
type ToolPermissionRequest = Parameters<Agent2Ui["requestToolPermission"]>[0]

export class ChatSessionRegistry {
  readonly #records = new Map<string, SessionRecord>()
  readonly #scheduler = new SerialTurnScheduler<PendingTurn>()
  readonly #dedupe = new Map<string, SendChatMessageResult>()
  readonly #pendingEvents = new Map<string, ChatEvent[]>()
  readonly #eventTimers = new Map<string, ReturnType<typeof setTimeout>>()
  #sink: Agent2Ui | undefined
  #chatSinks = new Set<Agent2Ui>()
  #projectRoot: string | undefined
  #disposed = false

  constructor(
    expectedProjectRoot?: string,
    private readonly defaultModelId?: string,
    private readonly options: {settingsStorage?: SettingsStorage} = {},
  ) {
    if (expectedProjectRoot?.trim()) this.#projectRoot = normalizeProjectRoot(expectedProjectRoot)
  }

  attach(sink: Agent2Ui): void {
    this.#chatSinks.add(sink)
    this.#sink = sink
  }

  detach(sink: Agent2Ui): void {
    this.#chatSinks.delete(sink)
    if (this.#sink === sink) {
      this.#sink = [...this.#chatSinks][this.#chatSinks.size - 1]
    }
    if (this.#chatSinks.size === 0) {
      void this.disconnect()
    }
  }

  async disconnect(): Promise<void> {
    this.#chatSinks.clear()
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
      (record): record is SessionRecord & {runtime: RuntimeSession} => Boolean(record.runtime),
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
      .map((record) => ({...record.summary}))
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
      const recent = await this.listRecentChatSessions({projectRoot})
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
    this.#emit(record, {kind: "snapshot", snapshot: this.#snapshot(record)})
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
    this.#emit(record, {kind: "sessionReleased", sessionId})
  }

  sendChatMessage(request: SendChatMessageRequest): SendChatMessageResult {
    const record = this.#requiredRecord(request.sessionId)
    const text = request.text.trim()
    if (!text) throw new Error("Message cannot be empty")
    const duplicate = this.#dedupe.get(request.clientMessageId)
    if (duplicate) return {...duplicate}
    if (this.#scheduler.queued.some((turn) => turn.sessionId === request.sessionId)) {
      throw new Error("This session already has a queued message")
    }
    if (this.#scheduler.active?.sessionId === request.sessionId) {
      throw new Error("Wait for the current turn to finish or stop it first")
    }

    record.lastPrompt = {text, contexts: request.contexts ?? []}
    const turn: PendingTurn = {
      turnId: makeId("turn"),
      sessionId: request.sessionId,
      text,
      contexts: request.contexts ?? [],
      clientMessageId: request.clientMessageId,
      submittedAt: now(),
      kind: "prompt",
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
      parts: [{kind: "text", text}],
      createdAt: turn.submittedAt,
      status: "complete",
    }
    this.#emit(record, {kind: "message", sessionId: request.sessionId, message: userMessage})
    this.#emitSummary(record)
    this.#emitQueue()

    const result: SendChatMessageResult = queued
      ? {turnId: turn.turnId, state: "queued", queuePosition: queuedState.position}
      : {turnId: turn.turnId, state: "running"}
    this.#rememberDedupe(request.clientMessageId, result)
    void this.#drainQueue()
    return result
  }

  retryChatTurn(sessionId: string): SendChatMessageResult {
    const record = this.#requiredRecord(sessionId)
    if (this.#scheduler.queued.some((turn) => turn.sessionId === sessionId)) {
      throw new Error("This session already has a queued message")
    }
    if (this.#scheduler.active?.sessionId === sessionId) {
      throw new Error("Wait for the current turn to finish or stop it first")
    }

    const turn: PendingTurn = {
      turnId: makeId("turn"),
      sessionId,
      text: record.lastPrompt?.text ?? "",
      contexts: record.lastPrompt?.contexts ?? [],
      clientMessageId: makeId("retry"),
      submittedAt: now(),
      kind: "retry",
    }
    const queuedState = this.#scheduler.enqueue(turn)
    const queued = !queuedState.immediate
    record.summary.state = queued ? "queued" : "running"
    record.summary.updatedAt = now()
    record.summary.queuePosition = queued ? queuedState.position : undefined
    record.lastAccess = now()
    this.#emitSummary(record)
    this.#emitQueue()

    const result: SendChatMessageResult = queued
      ? {turnId: turn.turnId, state: "queued", queuePosition: queuedState.position}
      : {turnId: turn.turnId, state: "running"}
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
    return {...record.summary}
  }

  async setChatThinkingLevel(sessionId: string, level: string): Promise<ChatSessionSummary> {
    const record = this.#requiredMutableRecord(sessionId)
    if (!THINKING_LEVELS.has(level)) throw new Error(`Invalid thinking level: ${level}`)
    await this.#ensureRuntime(record)
    record.runtime!.session.setThinkingLevel(level as never)
    this.#syncSummaryFromRuntime(record)
    this.#emitSummary(record)
    return {...record.summary}
  }

  markChatSessionRead(sessionId: string): void {
    const record = this.#requiredRecord(sessionId)
    if (!record.summary.unread) return
    record.summary.unread = false
    this.#emitSummary(record)
  }

  /** Test-only: insert a prebuilt open session without starting pi runtime. */
  __testInsertSession(record: {
    sessionId: string
    projectRoot: string
    title?: string
    state?: ChatSessionSummary["state"]
  }): void {
    const projectRoot = this.#ensureProject(record.projectRoot)
    this.#records.set(record.sessionId, {
      projectRoot,
      lastAccess: now(),
      sequence: 0,
      toolLocations: new Map(),
      approvedEditPaths: new Map(),
      permissionDecisions: new Map(),
      summary: {
        sessionId: record.sessionId,
        title: record.title ?? "New session",
        state: record.state ?? "idle",
        unread: false,
        updatedAt: now(),
        messageCount: 0,
      },
      thinkingClock: new ThinkingDurationClock(),
    })
  }

  /** Test-only: expose current summary for assertions. */
  __testGetSummary(sessionId: string): ChatSessionSummary | undefined {
    const record = this.#records.get(sessionId)
    return record ? {...record.summary} : undefined
  }

  /** Bind this agent process to a single project root for its lifetime. */
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
      thinkingClock: new ThinkingDurationClock(),
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
      log.warn("chat session dispose failed", {sessionId: record.summary.sessionId, err: error})
    })
  }

  /**
   * LRU dispose of idle runtimes when over MAX_RUNTIME_SESSIONS.
   * Never evict: keepSessionId, the active turn, or sessions waiting on the user.
   */
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
    if (!record.runtime) {
      return {summary: {...record.summary}, messages: []}
    }
    const session = record.runtime.session
    const messages = toChatMessages(
      session.messages,
      record.projectRoot,
      recordsFromBranch(session.sessionManager.getBranch()),
    )
    record.summary.messageCount = messages.length
    return {summary: {...record.summary}, messages}
  }

  #syncSummaryFromRuntime(record: SessionRecord): void {
    const session = record.runtime?.session
    if (!session) return
    record.sessionFile = session.sessionFile
    record.summary.sessionFile = session.sessionFile
    record.summary.title = firstLine(session.sessionName ?? record.summary.title)
    record.summary.modelId = session.model ? modelKey(session.model) : undefined
    record.summary.thinkingLevel = session.thinkingLevel ?? "off"
    record.summary.messageCount = toChatMessages(session.messages, record.projectRoot).length
    record.summary.updatedAt = now()
  }

  #requiredRecord(sessionId: string): SessionRecord {
    const record = this.#records.get(sessionId)
    if (!record) throw new Error(`Chat session is not open: ${sessionId}`)
    return record
  }

  #requiredMutableRecord(sessionId: string): SessionRecord {
    const record = this.#requiredRecord(sessionId)
    if (
      record.summary.state === "running" ||
      record.summary.state === "queued" ||
      this.#scheduler.active?.sessionId === sessionId
    ) {
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

  async #runSessionTurn(
    record: SessionRecord,
    session: AgentSession,
    turn: PendingTurn,
  ): Promise<void> {
    if (turn.kind === "retry") {
      const hasUser = session.messages.some((message) => message.role === "user")
      if (hasUser) {
        await session.sendCustomMessage(
          {
            customType: "vibefly.retry",
            content: RETRY_TURN_PROMPT,
            display: false,
          },
          {triggerTurn: true},
        )
        return
      }
      if (!turn.text.trim()) throw new Error("Nothing to retry")
    }

    const prompt = formatPrompt(turn.text, turn.contexts, record.projectRoot)
    if (record.summary.title === "New session" && turn.text.trim()) {
      const title = firstLine(turn.text)
      session.setSessionName(title)
      record.summary.title = title
    }
    await session.prompt(prompt, {source: "rpc"})
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
      await this.#runSessionTurn(record, runtime.session, turn)
      await runtime.session.waitForIdle()
      ok = true
      record.summary.state = "completed"
    } catch (error) {
      failure = errorMessage(error)
      // pi surfaces cancel as various messages; treat common abort phrasing as user cancel.
      aborted = /abort|stopped|interrupt/i.test(failure)
      record.summary.state = aborted ? "idle" : "error"
      log.warn("chat turn failed", {sessionId: turn.sessionId, turnId: turn.turnId, err: error})
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
    if (record) this.#emit(record, {kind: "queue", turns: this.#queuedTurns()})
  }

  #emitSummary(record: SessionRecord): void {
    this.#emit(record, {kind: "summary", summary: {...record.summary}})
  }

  /** Buffer events and flush after EVENT_BATCH_WINDOW_MS to coalesce stream noise. */
  #emit(record: SessionRecord, event: ChatEvent): void {
    const sessionId = record.summary.sessionId
    const events = this.#pendingEvents.get(sessionId) ?? []
    events.push(event)
    this.#pendingEvents.set(sessionId, events)
    if (this.#eventTimers.has(sessionId)) return
    const timer = setTimeout(() => this.#flushEvents(record), EVENT_BATCH_WINDOW_MS)
    this.#eventTimers.set(sessionId, timer)
  }

  /**
   * Deliver one batch to the UI. `sequence` is per-session and increments once
   * per flushed batch so the UI can detect gaps / reorder.
   */
  #flushEvents(record: SessionRecord): void {
    const sessionId = record.summary.sessionId
    this.#eventTimers.delete(sessionId)
    const events = this.#pendingEvents.get(sessionId)
    this.#pendingEvents.delete(sessionId)
    if (!events?.length || !this.#sink) return
    record.sequence += 1
    const batch: ChatEventBatch = {sessionId, sequence: record.sequence, events}
    void this.#sink.onChatEvents(batch).catch((error) => {
      log.debug("onChatEvents delivery failed", {sessionId, err: error})
    })
  }

  #onSessionEvent(record: SessionRecord, event: AgentSessionEvent): void {
    const durationRecord = noteThinkingDurationEvent(record.thinkingClock, event, now())
    if (durationRecord) {
      // pi notifies listeners of message_end *before* appendMessage. Defer so
      // the custom entry becomes a child of that assistant message.
      queueMicrotask(() => this.#persistThinkingDuration(record, durationRecord))
    }
    const mapped = mapSessionEvent(
      {
        sessionId: record.summary.sessionId,
        projectRoot: record.projectRoot,
        activeMessageId: record.activeMessageId,
        toolLocations: record.toolLocations,
      },
      event,
    )
    if (mapped.clearActiveMessageId) record.activeMessageId = undefined
    if (mapped.activeMessageId) record.activeMessageId = mapped.activeMessageId
    for (const chatEvent of mapped.events) this.#emit(record, chatEvent)
    if (mapped.syncSummary) {
      this.#syncSummaryFromRuntime(record)
      this.#emitSummary(record)
    }
  }

  #persistThinkingDuration(record: SessionRecord, data: ThinkingDurationData): void {
    const sessionManager = record.runtime?.session.sessionManager
    if (!sessionManager) return
    try {
      sessionManager.appendCustomEntry(THINKING_DURATION_CUSTOM_TYPE, data)
    } catch (error) {
      log.warn("thinking duration persist failed", {
        sessionId: record.summary.sessionId,
        err: error,
      })
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
          {requestId, sessionId: record.summary.sessionId, prompt, placeholder},
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
            parts: [{kind: "notice", level, text: message}],
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
      setTheme: () => ({success: false, error: "Theme selection is unavailable"}),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    }
  }
}
