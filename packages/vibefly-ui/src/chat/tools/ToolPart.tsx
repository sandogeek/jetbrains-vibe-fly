import {type ToolCallMessagePartProps, useThreadViewportStore} from "@assistant-ui/react"
import {useCallback, useContext} from "react"

import type {ToolArtifact} from "../../chatMessageAdapter"
import {ChatMessageActionsContext} from "../chatMessageActions"
import {presentTool} from "./presentTool"
import {ToolRow} from "./ToolRow"
import {toolRowModel} from "./toolRowModel"
import {bashCommandFailed} from "./presentBash"

export function ToolPart(part: ToolCallMessagePartProps) {
    const {onOpenLocation} = useContext(ChatMessageActionsContext)
    const releaseStickToBottom = useReleaseStickToBottom()
    const artifact = (part.artifact ?? {}) as ToolArtifact
    const status = artifact.status ?? (part.result === undefined ? "running" : "completed")
    const input = toolInputFromPart(part)
    const output = artifact.output
    const isError = Boolean(part.isError) || status === "failed"
    const running = status === "running" || status === "pending"
    const card = presentTool(part.toolName, input, output, isError, running)
    const model = toolRowModel({
        toolName: part.toolName,
        input,
        output,
        locations: artifact.locations,
        status,
        isError,
        commandFailed: card.kind === "terminal" && !running && bashCommandFailed(card.terminal),
    })
    return (
        <ToolRow
            toolCallId={part.toolCallId}
            argsText={part.argsText}
            output={output}
            model={model}
            card={card}
            onOpenLocation={onOpenLocation}
            onToggleExpand={releaseStickToBottom}
        />
    )
}

function toolInputFromPart(part: ToolCallMessagePartProps): unknown {
    if (part.args && typeof part.args === "object" && Object.keys(part.args).length > 0) {
        return part.args
    }
    if (!part.argsText) return undefined
    try {
        return JSON.parse(part.argsText)
    } catch {
        return undefined
    }
}

function useReleaseStickToBottom() {
    const store = useThreadViewportStore()
    return useCallback(() => {
        const writable = store as unknown as {
            getState: () => {isAtBottom: boolean}
            setState: (partial: {isAtBottom: boolean}) => void
        }
        if (writable.getState().isAtBottom) {
            writable.setState({isAtBottom: false})
        }
    }, [store])
}
