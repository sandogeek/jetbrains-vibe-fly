/** Shared UI <-> Agent DTOs. Every value crossing RPC must be JSON-serializable. */

export type ChatSessionState =
  | "idle"
  | "running"
  | "queued"
  | "waiting_permission"
  | "waiting_input"
  | "completed"
  | "error"

export type ChatTurnState = "running" | "queued"

export type ChatToolStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"

export type ChatMessageStatus =
  | "streaming"
  | "complete"
  | "aborted"
  | "error"

export type ChatFileLocation = {
  path: string
  line?: number
}

export type ChatPart =
  | { kind: "text"; text: string }
  | {
      kind: "thinking"
      text: string
      /**
       * Epoch ms when this thinking block started streaming. The UI stamps
       * this while a turn is live. Restored history fills it from the session
       * `vibefly.thinkingDuration` custom entry when present.
       */
      startedAt?: number
      /** Epoch ms when the model moved on from this thinking block. */
      endedAt?: number
    }
  | {
      kind: "tool"
      toolCallId: string
      name: string
      status: ChatToolStatus
      input?: unknown
      output?: string
      isError?: boolean
      locations?: ChatFileLocation[]
    }
  | { kind: "notice"; level: "info" | "warning" | "error"; text: string }

export type ChatMessage = {
  id: string
  role: "user" | "assistant" | "system"
  parts: ChatPart[]
  createdAt: number
  status: ChatMessageStatus
}

export type ChatContextItem = {
  id: string
  kind: "file" | "selection"
  path: string
  /** Selection text is process-local and capped by the host. */
  text?: string
  startLine?: number
  endLine?: number
}

export type ChatModelOption = {
  id: string
  provider: string
  model: string
  label: string
  supportsThinking: boolean
}

export type ChatSessionSummary = {
  sessionId: string
  title: string
  sessionFile?: string
  state: ChatSessionState
  unread: boolean
  queuePosition?: number
  modelId?: string
  thinkingLevel?: string
  updatedAt: number
  messageCount: number
}

export type ChatSessionSnapshot = {
  summary: ChatSessionSummary
  messages: ChatMessage[]
}

export type RecentChatSession = {
  sessionId: string
  title: string
  sessionFile: string
  updatedAt: number
  messageCount: number
  status?: string
}

export type OpenChatSessionRequest = {
  projectRoot: string
  sessionId?: string
  sessionFile?: string
}

export type ListChatSessionsRequest = {
  projectRoot: string
}

export type SendChatMessageRequest = {
  sessionId: string
  text: string
  contexts?: ChatContextItem[]
  clientMessageId: string
}

export type SendChatMessageResult = {
  turnId: string
  state: ChatTurnState
  queuePosition?: number
}

export type QueuedTurn = {
  turnId: string
  sessionId: string
  text: string
  submittedAt: number
  position: number
}

export type ToolPermissionRequest = {
  requestId: string
  sessionId: string
  toolCallId: string
  toolName: string
  title: string
  command?: string
  cwd?: string
  input?: unknown
  locations?: ChatFileLocation[]
}

export type ToolPermissionDecision =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always"
  | "cancelled"

export type ToolPermissionResponse = {
  requestId: string
  decision: ToolPermissionDecision
}

export type UserInputRequest = {
  requestId: string
  sessionId: string
  prompt: string
  placeholder?: string
}

export type UserInputResponse = {
  requestId: string
  text?: string
  cancelled: boolean
}

export type ChatEvent =
  | { kind: "snapshot"; snapshot: ChatSessionSnapshot }
  | { kind: "summary"; summary: ChatSessionSummary }
  | { kind: "message"; sessionId: string; message: ChatMessage }
  | {
      kind: "partDelta"
      sessionId: string
      messageId: string
      partKind: "text" | "thinking"
      delta: string
    }
  | {
      kind: "messageStatus"
      sessionId: string
      messageId: string
      status: ChatMessageStatus
    }
  | {
      kind: "tool"
      sessionId: string
      messageId: string
      part: Extract<ChatPart, { kind: "tool" }>
    }
  | { kind: "queue"; turns: QueuedTurn[] }
    | { kind: "modelCatalogChanged"; sessionId: string }
  | {
      kind: "turnComplete"
      sessionId: string
      turnId: string
      ok: boolean
      aborted?: boolean
      error?: string
    }
  | { kind: "sessionReleased"; sessionId: string }
  | { kind: "disconnected"; message: string }

export type ChatEventBatch = {
  sessionId: string
  sequence: number
  events: ChatEvent[]
}
