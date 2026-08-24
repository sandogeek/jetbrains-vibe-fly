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

import remarkBreaks from "remark-breaks"
import {defaultRemarkPlugins, type StreamdownProps} from "streamdown"

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

/** Preserve Streamdown GFM (tables, strikethrough, task lists) while adding soft breaks. */
const remarkPlugins: NonNullable<StreamdownProps["remarkPlugins"]> = [
    ...Object.values(defaultRemarkPlugins),
    remarkBreaks,
]

export type {ChatMessageActions}
export {ChatMessageActionsContext}

const assistantPartGroupBy = groupPartByType({
    reasoning: ["group-reasoning"],
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
                            <ReasoningRoot variant="ghost" streaming={running}>
                                <ReasoningTrigger active={running} label={t("chat:reasoning")}/>
                                <ReasoningContent aria-busy={running}>
                                    <ReasoningText>{children}</ReasoningText>
                                </ReasoningContent>
                            </ReasoningRoot>
                        )
                    }
                    case "reasoning":
                        return <MarkdownText containerClassName="markdown-body reasoning-markdown"/>
                    case "text":
                        return <MarkdownText/>
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

const userMessagePartsComponents = {
    Text: UserText,
}
