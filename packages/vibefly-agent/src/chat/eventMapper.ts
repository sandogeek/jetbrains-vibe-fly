import type {AgentSessionEvent} from "@earendil-works/pi-coding-agent"
import type {AgentMessage} from "@earendil-works/pi-agent-core"
import type {
  ChatEvent,
  ChatFileLocation,
  ChatMessage,
  ChatPart,
} from "@vibefly/uiagent-shared"
import {locationsFromArgs} from "./toolPathGuard.js"
import {makeId, now, textFromContent, toolResultText} from "./util.js"
import {applyThinkingDurations, type ThinkingDurationData} from "./thinkingDuration.js"

export {safeJson, textFromContent, toolResultText} from "./util.js"

export function messageParts(message: AgentMessage, projectRoot?: string): ChatPart[] {
  const raw = message as unknown as Record<string, unknown>
  const content = raw.content
  if (typeof content === "string") return content ? [{kind: "text", text: content}] : []
  if (!Array.isArray(content)) return []

  const parts: ChatPart[] = []
  for (const value of content) {
    if (!value || typeof value !== "object") continue
    const part = value as Record<string, unknown>
    if (part.type === "text" && typeof part.text === "string") {
      parts.push({kind: "text", text: part.text})
    } else if (part.type === "thinking" && typeof part.thinking === "string") {
      parts.push({kind: "thinking", text: part.thinking})
    } else if (part.type === "toolCall") {
      const toolName = String(part.name ?? "tool")
      const input = part.arguments
      parts.push({
        kind: "tool",
        toolCallId: String(part.id ?? makeId("tool")),
        name: toolName,
        status: "completed",
        input,
        locations: projectRoot ? locationsFromArgs(input, projectRoot, toolName) : undefined,
      })
    }
  }
  return parts
}

export function messageStatus(message: AgentMessage): ChatMessage["status"] {
  const raw = message as unknown as Record<string, unknown>
  if (raw.stopReason === "aborted") return "aborted"
  if (raw.stopReason === "error" || raw.errorMessage) return "error"
  return "complete"
}

export function toChatMessages(
  messages: AgentMessage[],
  projectRoot?: string,
  thinkingDurations: readonly ThinkingDurationData[] = [],
): ChatMessage[] {
  const result: ChatMessage[] = []
  const toolParts = new Map<string, Extract<ChatPart, {kind: "tool"}>>()

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
    const parts = messageParts(messages[index]!, projectRoot)
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
  applyThinkingDurations(result, thinkingDurations)
  return result
}

export type SessionEventMapState = {
  sessionId: string
  projectRoot: string
  activeMessageId?: string
  toolLocations: Map<string, ChatFileLocation[]>
}

export type SessionEventMapResult = {
  activeMessageId?: string
  clearActiveMessageId?: boolean
  syncSummary?: boolean
  events: ChatEvent[]
}

/** Map a pi AgentSessionEvent into UI chat events (pure; mutates toolLocations map). */
export function mapSessionEvent(
  state: SessionEventMapState,
  event: AgentSessionEvent,
): SessionEventMapResult {
  if (event.type === "agent_start") {
    const activeMessageId = makeId("assistant")
    return {
      activeMessageId,
      events: [{
        kind: "message",
        sessionId: state.sessionId,
        message: {
          id: activeMessageId,
          role: "assistant",
          parts: [],
          createdAt: now(),
          status: "streaming",
        },
      }],
    }
  }
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent
    if (update.type !== "text_delta" && update.type !== "thinking_delta") {
      return {events: []}
    }
    const activeMessageId = state.activeMessageId ?? makeId("assistant")
    // `activeMessageId: undefined` means "keep stored id"; only set when creating one.
    return {
      activeMessageId: state.activeMessageId ? undefined : activeMessageId,
      events: [{
        kind: "partDelta",
        sessionId: state.sessionId,
        messageId: activeMessageId,
        partKind: update.type === "text_delta" ? "text" : "thinking",
        delta: update.delta,
      }],
    }
  }
  if (event.type === "tool_execution_start") {
    const activeMessageId = state.activeMessageId ?? makeId("assistant")
    const locations = locationsFromArgs(event.args, state.projectRoot, event.toolName)
    if (locations) state.toolLocations.set(event.toolCallId, locations)
    // Same carrier convention as message_update: only assign when no active message yet.
    return {
      activeMessageId: state.activeMessageId ? undefined : activeMessageId,
      events: [{
        kind: "tool",
        sessionId: state.sessionId,
        messageId: activeMessageId,
        part: {
          kind: "tool",
          toolCallId: event.toolCallId,
          name: event.toolName,
          status: "running",
          input: event.args,
          locations,
        },
      }],
    }
  }
  if (event.type === "tool_execution_update") {
    if (!state.activeMessageId) return {events: []}
    return {
      events: [{
        kind: "tool",
        sessionId: state.sessionId,
        messageId: state.activeMessageId,
        part: {
          kind: "tool",
          toolCallId: event.toolCallId,
          name: event.toolName,
          status: "running",
          output: toolResultText(event.partialResult),
        },
      }],
    }
  }
  if (event.type === "tool_execution_end") {
    // Tool results only attach to an in-flight assistant message; drop if already cleared.
    if (!state.activeMessageId) return {events: []}
    const locations = state.toolLocations.get(event.toolCallId)
    state.toolLocations.delete(event.toolCallId)
    return {
      events: [{
        kind: "tool",
        sessionId: state.sessionId,
        messageId: state.activeMessageId,
        part: {
          kind: "tool",
          toolCallId: event.toolCallId,
          name: event.toolName,
          status: event.isError ? "failed" : "completed",
          output: toolResultText(event.result),
          isError: event.isError,
          locations,
        },
      }],
    }
  }
  // pi event typing omits `role` on message; cast to filter assistant-only ends.
  if (event.type === "message_end" && (event.message as unknown as {role?: string}).role === "assistant") {
    if (!state.activeMessageId) return {events: []}
    return {
      events: [{
        kind: "messageStatus",
        sessionId: state.sessionId,
        messageId: state.activeMessageId,
        status: messageStatus(event.message),
      }],
    }
  }
  if (event.type === "agent_end") {
    return {clearActiveMessageId: true, events: []}
  }
  if (event.type === "thinking_level_changed") {
    return {syncSummary: true, events: []}
  }
  return {events: []}
}

export function clientPermissionKey(toolName: string, title: string): string {
  if (toolName === "edit" && /^delete\b/i.test(title)) return "edit:delete"
  if (toolName === "edit" && /^move\b/i.test(title)) return "edit:move"
  return toolName
}
