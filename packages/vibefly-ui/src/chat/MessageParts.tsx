import {
    type DataMessagePartProps,
    groupPartByType,
    MessagePrimitive,
    type ToolCallMessagePartProps,
    useAuiState,
} from "@assistant-ui/react"
import {StreamdownTextPrimitive} from "@assistant-ui/react-streamdown"
import {cjk} from "@streamdown/cjk"
import {code} from "@streamdown/code"
import {AlertTriangle, RotateCcw} from "lucide-react"
import {type ReactNode, useEffect, useState} from "react"

import remarkBreaks from "remark-breaks"
import {defaultRemarkPlugins, type StreamdownProps} from "streamdown"

import {type ReasoningContentPart} from "../chatMessageAdapter"
import {
    ReasoningContent,
    ReasoningRoot,
    ReasoningText,
    ReasoningTrigger,
} from "../components/assistant-ui/reasoning"
import {useAppTranslation} from "../i18n"
import {runningShimmerClassName} from "../lib/shimmer"
import {ChatMessageActionsContext, type ChatMessageActions} from "./chatMessageActions"
import {ToolPart} from "./tools/ToolPart"
import {ToolTimelineGroup} from "./tools/ToolTimelineGroup"

/** Preserve Streamdown GFM (tables, strikethrough, task lists) while adding soft breaks. */
const remarkPlugins: NonNullable<StreamdownProps["remarkPlugins"]> = [
    ...Object.values(defaultRemarkPlugins),
    remarkBreaks,
]

export type {ChatMessageActions}
export {ChatMessageActionsContext}

const assistantPartGroupBy = groupPartByType({
    reasoning: ["group-reasoning"],
    "tool-call": ["group-tool"],
})

export function ChatMessageView() {
    const {t} = useAppTranslation("chat")
    const role = useAuiState((state) => state.message.role)
    const status = useAuiState((state) => state.message.status)
    const content = useAuiState((state) => state.message.content)
    const isRunning = status?.type === "running"
    const hasVisibleContent = content.some((part) => {
        if (part.type === "text" || part.type === "reasoning") {
            return part.text.trim().length > 0
        }
        return part.type === "tool-call" || part.type === "data"
    })

    if (role === "user") {
        return (
            <MessagePrimitive.Root className="chat-message user">
                <MessagePrimitive.Parts components={userMessagePartsComponents}/>
            </MessagePrimitive.Root>
        )
    }

    return (
        <MessagePrimitive.Root className={`chat-message ${role}`}>
            <div className="assistant-content">
                <AssistantMessageParts/>
                {isRunning && !hasVisibleContent ? (
                    <span className={runningShimmerClassName}>
                        {t("chat:generating")}
                    </span>
                ) : null}
                {isRunning && hasVisibleContent ? <span className="streaming-caret"/> : null}
                {status?.type === "incomplete" && status.reason === "error" ? (
                    <button className="retry-button">
                        <RotateCcw size={13}/> {t("chat:retry")}
                    </button>
                ) : null}
            </div>
        </MessagePrimitive.Root>
    )
}

function UserText({text}: { text: string }) {
    return <div className="user-message-text">{text}</div>
}

function MarkdownText({
    containerClassName = "markdown-body",
}: {
    containerClassName?: string
}) {
    return (
        <StreamdownTextPrimitive
            containerClassName={containerClassName}
            plugins={{code, cjk}}
            remarkPlugins={remarkPlugins}
            controls={{code: true, table: false}}
            linkSafety={{enabled: false}}
            security={{
                allowedProtocols: ["http", "https"],
                allowedLinkPrefixes: ["*"],
                allowedImagePrefixes: [],
                allowDataImages: false,
            }}
        />
    )
}

type NoticeData = { level: "info" | "warning" | "error"; text: string }

function NoticePart({data}: DataMessagePartProps<NoticeData>) {
    return (
        <div className={`notice-part ${data.level === "error" ? "error" : ""}`}>
            <AlertTriangle size={14}/>
            {data.text}
        </div>
    )
}

function AssistantMessageParts() {
    const {t} = useAppTranslation("chat")
    return (
        <MessagePrimitive.GroupedParts groupBy={assistantPartGroupBy}>
            {({part, children}) => {
                switch (part.type) {
                    case "group-reasoning": {
                        const running = part.status.type === "running"
                        return (
                            <ReasoningGroupSection running={running} indices={part.indices}>
                                {children}
                            </ReasoningGroupSection>
                        )
                    }
                    case "reasoning":
                        return <MarkdownText containerClassName="markdown-body reasoning-markdown"/>
                    case "text":
                        return <MarkdownText/>
                    case "group-tool":
                        return <ToolTimelineGroup part={part}>{children}</ToolTimelineGroup>
                    case "tool-call":
                        return <ToolPart {...(part as ToolCallMessagePartProps)} />
                    case "data":
                        return part.name === "vibefly-notice"
                            ? <NoticePart {...(part as DataMessagePartProps<NoticeData>)} />
                            : null
                    default:
                        return null
                }
            }}
        </MessagePrimitive.GroupedParts>
    )
}

/**
 * Elapsed ms of a still-open thinking block. Re-renders every 100ms while
 * active so the trigger label counts up like Cursor's "Thinking" timer.
 */
function useLiveElapsedMs(startedAt: number | undefined, active: boolean): number {
    const [elapsedMs, setElapsedMs] = useState(0)
    useEffect(() => {
        if (!active || startedAt === undefined) return
        const update = () => setElapsedMs(Math.max(0, Date.now() - startedAt))
        update()
        const timer = window.setInterval(update, 100)
        return () => window.clearInterval(timer)
    }, [active, startedAt])
    return active && startedAt !== undefined ? elapsedMs : 0
}

function ReasoningGroupSection({
    running,
    indices,
    children,
}: {
    running: boolean
    indices: readonly number[]
    children: ReactNode
}) {
    const {t} = useAppTranslation("chat")
    const messageParts = useAuiState((state) => state.message.parts)
    // The runtime keeps the custom duration fields even though assistant-ui's
    // static part types don't declare them.
    const reasoningBlocks = indices
        .map((index) => messageParts[index])
        .filter((part) => part?.type === "reasoning") as unknown as ReasoningContentPart[]
    // Finished blocks carry their measured duration; the open one is timed live.
    const closedTotalMs = reasoningBlocks.reduce(
        (total, block) => total + (block.durationMs ?? 0),
        0,
    )
    const openBlockStartedAt = running
        ? reasoningBlocks.find((block) => block.durationMs === undefined)?.startedAt
        : undefined
    const liveElapsedMs = useLiveElapsedMs(openBlockStartedAt, running)

    return (
        <ReasoningRoot variant="ghost" streaming={running}>
            <ReasoningTrigger
                active={running}
                durationMs={closedTotalMs + liveElapsedMs}
                label={t("chat:reasoning")}
            />
            <ReasoningContent aria-busy={running}>
                <ReasoningText>{children}</ReasoningText>
            </ReasoningContent>
        </ReasoningRoot>
    )
}

const userMessagePartsComponents = {
    Text: UserText,
}
