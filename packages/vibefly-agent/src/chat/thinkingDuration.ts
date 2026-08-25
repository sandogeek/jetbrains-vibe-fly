import type {AgentSessionEvent} from "@earendil-works/pi-coding-agent"
import type {ChatMessage, ChatPart} from "@vibefly/uiagent-shared"

/** Session JSONL customType; ignored by pi LLM context. */
export const THINKING_DURATION_CUSTOM_TYPE = "vibefly.thinkingDuration"

export type ThinkingDurationBlock = {
  contentIndex: number
  startedAt: number
  endedAt: number
}

export type ThinkingDurationData = {
  /** pi AssistantMessage.timestamp; matches ChatMessage.createdAt on replay. */
  messageTimestamp: number
  blocks: ThinkingDurationBlock[]
}

type OpenThinkingBlock = {
  contentIndex: number
  startedAt: number
  endedAt?: number
}

/**
 * Per-session wall-clock for thinking_start / thinking_end.
 * Live UI still times independently; this clock is what gets persisted.
 */
export class ThinkingDurationClock {
  readonly #blocks: OpenThinkingBlock[] = []

  noteStart(contentIndex: number, atMs: number): void {
    if (this.#blocks.some((block) => block.contentIndex === contentIndex)) return
    this.#blocks.push({contentIndex, startedAt: atMs})
  }

  noteEnd(contentIndex: number, atMs: number): void {
    const block = this.#blocks.find(
      (candidate) => candidate.contentIndex === contentIndex && candidate.endedAt === undefined,
    )
    if (!block) return
    block.endedAt = Math.max(atMs, block.startedAt)
  }

  /** Stamp endedAt on any block still open (abort, error, or missing thinking_end). */
  closeOpen(atMs: number): void {
    for (const block of this.#blocks) {
      if (block.endedAt === undefined) {
        block.endedAt = Math.max(atMs, block.startedAt)
      }
    }
  }

  take(): ThinkingDurationBlock[] {
    const blocks = this.#blocks
      .filter((block): block is ThinkingDurationBlock => block.endedAt !== undefined)
      .map((block) => ({
        contentIndex: block.contentIndex,
        startedAt: block.startedAt,
        endedAt: block.endedAt,
      }))
      .sort((left, right) => left.contentIndex - right.contentIndex)
    this.#blocks.length = 0
    return blocks
  }

  clear(): void {
    this.#blocks.length = 0
  }
}

/**
 * Drive the clock from a pi session event. On assistant `message_end` with
 * thinking, returns the payload to persist after pi has appended that message.
 */
export function noteThinkingDurationEvent(
  clock: ThinkingDurationClock,
  event: AgentSessionEvent,
  nowMs: number,
): ThinkingDurationData | undefined {
  if (event.type === "agent_start") {
    clock.clear()
    return undefined
  }
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent
    if (update.type === "thinking_start") clock.noteStart(update.contentIndex, nowMs)
    else if (update.type === "thinking_end") clock.noteEnd(update.contentIndex, nowMs)
    return undefined
  }
  if (event.type === "message_end") {
    const message = event.message as unknown as Record<string, unknown>
    if (message.role !== "assistant") return undefined
    clock.closeOpen(nowMs)
    const timestamp = typeof message.timestamp === "number" ? message.timestamp : undefined
    if (timestamp === undefined || !assistantContentHasThinking(message.content)) {
      clock.clear()
      return undefined
    }
    const blocks = clock.take()
    if (blocks.length === 0) return undefined
    return {messageTimestamp: timestamp, blocks}
  }
  if (event.type === "agent_end") {
    clock.clear()
  }
  return undefined
}

export type SessionBranchEntry = {
  type: string
  customType?: string
  data?: unknown
}

/** Pull duration records off the current session branch (compaction-aware). */
export function recordsFromBranch(entries: readonly SessionBranchEntry[]): ThinkingDurationData[] {
  const records: ThinkingDurationData[] = []
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== THINKING_DURATION_CUSTOM_TYPE) continue
    const parsed = parseThinkingDurationData(entry.data)
    if (parsed) records.push(parsed)
  }
  return records
}

export function parseThinkingDurationData(value: unknown): ThinkingDurationData | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (typeof record.messageTimestamp !== "number" || !Number.isFinite(record.messageTimestamp)) {
    return undefined
  }
  if (!Array.isArray(record.blocks)) return undefined
  const blocks: ThinkingDurationBlock[] = []
  for (const item of record.blocks) {
    if (!item || typeof item !== "object") continue
    const block = item as Record<string, unknown>
    if (
      typeof block.contentIndex !== "number" ||
      !Number.isFinite(block.contentIndex) ||
      typeof block.startedAt !== "number" ||
      !Number.isFinite(block.startedAt) ||
      typeof block.endedAt !== "number" ||
      !Number.isFinite(block.endedAt)
    ) {
      continue
    }
    blocks.push({
      contentIndex: block.contentIndex,
      startedAt: block.startedAt,
      endedAt: Math.max(block.endedAt, block.startedAt),
    })
  }
  if (blocks.length === 0) return undefined
  return {messageTimestamp: record.messageTimestamp, blocks}
}

/**
 * Stamp startedAt/endedAt onto thinking parts. Matches by ChatMessage.createdAt
 * (pi message timestamp) then applies blocks in contentIndex order to thinking
 * parts in document order. Unmatched records (compacted messages, old sessions)
 * are skipped.
 */
export function applyThinkingDurations(
  messages: ChatMessage[],
  records: readonly ThinkingDurationData[],
): ChatMessage[] {
  if (records.length === 0) return messages
  const unused = [...records]
  for (const message of messages) {
    if (message.role !== "assistant") continue
    const thinkingParts = message.parts.filter(
      (part): part is Extract<ChatPart, {kind: "thinking"}> => part.kind === "thinking",
    )
    if (thinkingParts.length === 0) continue
    const recordIndex = unused.findIndex((record) => record.messageTimestamp === message.createdAt)
    if (recordIndex < 0) continue
    const [matched] = unused.splice(recordIndex, 1)
    if (!matched) continue
    const blocks = [...matched.blocks].sort((left, right) => left.contentIndex - right.contentIndex)
    for (let index = 0; index < thinkingParts.length && index < blocks.length; index += 1) {
      const part = thinkingParts[index]!
      const block = blocks[index]!
      part.startedAt = block.startedAt
      part.endedAt = block.endedAt
    }
  }
  return messages
}

function assistantContentHasThinking(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some((part) => {
    if (!part || typeof part !== "object") return false
    return (part as {type?: unknown}).type === "thinking"
  })
}
