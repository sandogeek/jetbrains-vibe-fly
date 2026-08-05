import type {ThreadMessageLike} from "@assistant-ui/react"
import type {ChatMessage, ChatPart} from "@vibefly/uiagent-shared"

export type ToolArtifact = {
    status: Extract<ChatPart, { kind: "tool" }>["status"]
    output?: string
    locations?: Extract<ChatPart, { kind: "tool" }>["locations"]
}

type ConvertedPart = Exclude<ThreadMessageLike["content"], string>[number]

function messageStatus(message: ChatMessage): ThreadMessageLike["status"] {
    switch (message.status) {
        case "streaming":
            return {type: "running"}
        case "complete":
            return {type: "complete", reason: "stop"}
        case "aborted":
            return {type: "incomplete", reason: "cancelled"}
        case "error":
            return {type: "incomplete", reason: "error"}
    }
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value ?? {})
    } catch {
        return "{}"
    }
}

function convertPart(part: ChatPart): ConvertedPart | null {
    switch (part.kind) {
        case "text":
            return {type: "text", text: part.text}
        case "thinking":
            return {type: "reasoning", text: part.text}
        case "notice":
            return {
                type: "data",
                name: "vibefly-notice",
                data: {level: part.level, text: part.text},
            }
        case "tool": {
            const artifact: ToolArtifact = {
                status: part.status,
                output: part.output,
                locations: part.locations,
            }
            const completed = part.status === "completed" || part.status === "failed"
            return {
                type: "tool-call",
                toolCallId: part.toolCallId,
                toolName: part.name,
                argsText: safeStringify(part.input),
                artifact,
                ...(completed ? {result: part.output ?? null} : {}),
                isError: part.isError || part.status === "failed",
            }
        }
        default:
            return null
    }
}

export function convertChatMessage(message: ChatMessage): ThreadMessageLike {
    const content = message.parts.map(convertPart).filter((part): part is ConvertedPart => part != null)
    // assistant-ui (fromThreadMessageLike):
    // - status is only valid on assistant messages
    // - system messages must be a single text part; map system notices to assistant
    if (message.role === "user") {
        return {
            id: message.id,
            role: "user",
            createdAt: new Date(message.createdAt),
            content,
        }
    }
    return {
        id: message.id,
        role: "assistant",
        createdAt: new Date(message.createdAt),
        content,
        status: messageStatus(message),
    }
}
