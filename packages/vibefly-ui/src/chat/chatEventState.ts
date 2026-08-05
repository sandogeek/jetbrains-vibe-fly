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
                const index = message.parts.findIndex((part) => part.kind === event.partKind)
                if (index < 0) {
                    return {
                        ...message,
                        parts: [...message.parts, {kind: event.partKind, text: event.delta}],
                    }
                }
                const parts = [...message.parts]
                const part = parts[index] as Extract<ChatPart, { kind: "text" | "thinking" }>
                parts[index] = {...part, text: part.text + event.delta}
                return {...message, parts}
            }),
            effects: {refreshPaths: []},
        }
    }

    if (event.kind === "messageStatus") {
        return {
            tabs: updateMessage(tabs, event.sessionId, event.messageId, (message) => ({
                ...message,
                status: event.status,
            })),
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
                const index = message.parts.findIndex(
                    (part) => part.kind === "tool" && part.toolCallId === event.part.toolCallId,
                )
                if (index < 0) return {...message, parts: [...message.parts, event.part]}
                const parts = [...message.parts]
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
