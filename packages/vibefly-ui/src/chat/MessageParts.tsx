import {
    type DataMessagePartProps,
    MessagePrimitive,
    useAuiState,
    useThreadViewportStore,
} from "@assistant-ui/react"
import {StreamdownTextPrimitive} from "@assistant-ui/react-streamdown"
import {cjk} from "@streamdown/cjk"
import {code} from "@streamdown/code"
import {
    AlertTriangle,
    Brain,
    ChevronDown,
    RotateCcw,
} from "lucide-react"
import {useCallback, useState} from "react"

import remarkBreaks from "remark-breaks"
import {defaultRemarkPlugins, type StreamdownProps} from "streamdown"

import {useAppTranslation} from "../i18n"
import {runningShimmerClassName} from "../lib/shimmer"
import {ChatMessageActionsContext, type ChatMessageActions} from "./chatMessageActions"
import {ToolPart} from "./tools/ToolPart"

/** Preserve Streamdown GFM (tables, strikethrough, task lists) while adding soft breaks. */
const remarkPlugins: NonNullable<StreamdownProps["remarkPlugins"]> = [
    ...Object.values(defaultRemarkPlugins),
    remarkBreaks,
]

export type {ChatMessageActions}
export {ChatMessageActionsContext}

/** Stop stick-to-bottom so expand/collapse + streaming do not yank the viewport. */
function useReleaseStickToBottom() {
    const store = useThreadViewportStore()
    return useCallback(() => {
        const writable = store as unknown as {
            getState: () => { isAtBottom: boolean }
            setState: (partial: { isAtBottom: boolean }) => void
        }
        if (writable.getState().isAtBottom) {
            writable.setState({isAtBottom: false})
        }
    }, [store])
}

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
                <MessagePrimitive.Parts components={assistantMessagePartsComponents}/>
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

function MarkdownText() {
    return (
        <StreamdownTextPrimitive
            containerClassName="markdown-body"
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

function ReasoningPart({text}: { text: string }) {
    const {t} = useAppTranslation("chat")
    const [open, setOpen] = useState(true)
    const releaseStickToBottom = useReleaseStickToBottom()
    const isRunning = useAuiState((state) => state.message.status?.type === "running")
    return (
        <div className={`thinking-block ${open ? "open" : ""}`}>
            <button
                className="thinking-toggle"
                onClick={() => {
                    releaseStickToBottom()
                    setOpen((value) => !value)
                }}
            >
                <Brain size={15}/>
                <span className={isRunning ? runningShimmerClassName : undefined}>
                    {t("chat:reasoning")}
                </span>
                <ChevronDown size={14}/>
            </button>
            {open ? <div className="thinking-content">{text}</div> : null}
        </div>
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

const userMessagePartsComponents = {
    Text: UserText,
}

const assistantMessagePartsComponents = {
    Text: MarkdownText,
    Reasoning: ReasoningPart,
    tools: {Fallback: ToolPart},
    data: {by_name: {"vibefly-notice": NoticePart}},
}
