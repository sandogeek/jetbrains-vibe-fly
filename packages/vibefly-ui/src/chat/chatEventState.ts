import type {ChatEvent, ChatMessage, ChatPart, ChatSessionSnapshot} from "@vibefly/uiagent-shared"
import type {ChatTab} from "./types"

export type ChatEventEffects = {
    error?: string
    refreshPaths: string[]
}

export type ChatEventResult = {
    tabs: ChatTab[]
    effects: ChatEventEffects
}

function updateMessages(
    tabs: ChatTab[],
    sessionId: string,
    update: (messages: ChatMessage[]) => ChatMessage[],
): ChatTab[] {
    return tabs.map((tab) =>
        tab.summary.sessionId === sessionId ? {...tab, messages: update(tab.messages)} : tab,
    )
}

function updateMessage(
    tabs: ChatTab[],
    sessionId: string,
    messageId: string,
    update: (message: ChatMessage) => ChatMessage,
): ChatTab[] {
    return updateMessages(tabs, sessionId, (messages) => {
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

function replaceOrAppendSnapshot(tabs: ChatTab[], snapshot: ChatSessionSnapshot): ChatTab[] {
    const index = tabs.findIndex((tab) => tab.summary.sessionId === snapshot.summary.sessionId)
    if (index < 0) return [...tabs, snapshot]
    return tabs.map((tab, tabIndex) => (tabIndex === index ? snapshot : tab))
}

/**
 * Close the trailing thinking block (if it is still open) by stamping its
 * end time. Used whenever the model moves on from thinking: a text delta,
 * a tool call, or the end of the message.
 */
function closeTrailingThinking(parts: ChatPart[], endedAt: number): void {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index]!
        if (part.kind !== "thinking") break
        if (part.endedAt !== undefined) return
        parts[index] = {...part, endedAt}
        return
    }
}

export function applyChatEvent(
    tabs: ChatTab[],
    event: ChatEvent,
    activeSessionId: string,
): ChatEventResult {
    if (event.kind === "snapshot") {
        return {tabs: replaceOrAppendSnapshot(tabs, event.snapshot), effects: {refreshPaths: []}}
    }

    if (event.kind === "summary") {
        return {
            tabs: tabs.map((tab) =>
                tab.summary.sessionId === event.summary.sessionId
                    ? {
                        ...tab,
                        summary: {
                            ...tab.summary,
                            ...event.summary,
                            unread:
                                event.summary.sessionId === activeSessionId
                                    ? false
                                    : event.summary.unread,
                        },
                    }
                    : tab,
            ),
            effects: {refreshPaths: []},
        }
    }

    if (event.kind === "message") {
        return {
            tabs: updateMessages(tabs, event.sessionId, (messages) => {
                const duplicate = messages.some((message) => message.id === event.message.id)
                if (duplicate) {
                    return messages.map((message) =>
                        message.id === event.message.id ? event.message : message,
                    )
                }
                return [...messages, event.message]
            }),
            effects: {refreshPaths: []},
        }
    }

    if (event.kind === "partDelta") {
        return {
            tabs: updateMessage(tabs, event.sessionId, event.messageId, (message) => {
                const nowMs = Date.now()
                const parts = [...message.parts]
                if (event.partKind === "thinking") {
                    const lastIndex = parts.length - 1
                    const lastPart = parts[lastIndex]
                    if (lastPart?.kind === "thinking") {
                        // Extend the trailing block, reopening it if it was already closed.
                        parts[lastIndex] = {
                            ...lastPart,
                            text: lastPart.text + event.delta,
                            endedAt: undefined,
                        }
                    } else {
                        parts.push({kind: "thinking", text: event.delta, startedAt: nowMs})
                    }
                } else {
                    closeTrailingThinking(parts, nowMs)
                    const index = parts.findIndex((part) => part.kind === "text")
                    if (index < 0) {
                        parts.push({kind: "text", text: event.delta})
                    } else {
                        const part = parts[index] as Extract<ChatPart, { kind: "text" }>
                        parts[index] = {...part, text: part.text + event.delta}
                    }
                }
                return {...message, parts}
            }),
            effects: {refreshPaths: []},
        }
    }

    if (event.kind === "messageStatus") {
        return {
            tabs: updateMessage(tabs, event.sessionId, event.messageId, (message) => {
                if (event.status === "streaming") return {...message, status: event.status}
                // A terminal status ends any still-open thinking block.
                const parts = [...message.parts]
                closeTrailingThinking(parts, Date.now())
                return {...message, status: event.status, parts}
            }),
            effects: {refreshPaths: []},
        }
    }

    if (event.kind === "tool") {
        const refreshPaths =
            event.part.status === "completed" &&
            (event.part.name === "edit" || event.part.name === "write")
                ? event.part.locations?.map((location) => location.path) ?? []
                : []
        return {
            tabs: updateMessage(tabs, event.sessionId, event.messageId, (message) => {
                // A tool call interrupts thinking; close the open block first.
                const parts = [...message.parts]
                closeTrailingThinking(parts, Date.now())
                const index = message.parts.findIndex(
                    (part) => part.kind === "tool" && part.toolCallId === event.part.toolCallId,
                )
                if (index < 0) return {...message, parts: [...parts, event.part]}
                parts[index] = {
                    ...(parts[index] as Extract<ChatPart, { kind: "tool" }>),
                    ...event.part,
                }
                return {...message, parts}
            }),
            effects: {refreshPaths},
        }
    }

    if (event.kind === "turnComplete") {
        return {
            tabs: tabs.map((tab) =>
                tab.summary.sessionId === event.sessionId
                    ? {
                        ...tab,
                        summary: {
                            ...tab.summary,
                            state: event.ok ? "completed" : event.aborted ? "idle" : "error",
                            unread: event.sessionId !== activeSessionId,
                        },
                    }
                    : tab,
            ),
            effects: {
                refreshPaths: [],
                ...(event.error && !event.aborted ? {error: event.error} : {}),
            },
        }
    }

    if (event.kind === "sessionReleased") {
        return {
            tabs: tabs.filter((tab) => tab.summary.sessionId !== event.sessionId),
            effects: {refreshPaths: []},
        }
    }

    if (event.kind === "disconnected") {
        return {tabs, effects: {refreshPaths: [], error: event.message}}
    }

    return {tabs, effects: {refreshPaths: []}}
}
