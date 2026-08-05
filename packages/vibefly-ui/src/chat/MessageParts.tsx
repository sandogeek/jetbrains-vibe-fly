import {
    type DataMessagePartProps,
    MessagePrimitive,
    type ToolCallMessagePartProps,
    useAuiState,
} from "@assistant-ui/react"
import {StreamdownTextPrimitive} from "@assistant-ui/react-streamdown"
import {cjk} from "@streamdown/cjk"
import {code} from "@streamdown/code"
import {
    AlertTriangle,
    Brain,
    Check,
    ChevronDown,
    GitCompareArrows,
    LoaderCircle,
    RotateCcw,
    Wrench,
} from "lucide-react"
import {useCallback, useState} from "react"

import remarkBreaks from "remark-breaks"
import {useAppTranslation} from "../i18n"
import type {ToolArtifact} from "../chatMessageAdapter"

export function ChatMessageView({
                                    onOpenLocation,
                                    onShowDiff,
                                }: {
    onOpenLocation: (path: string, line?: number) => void
    onShowDiff: (path: string) => void
}) {
    const {t} = useAppTranslation("chat")
    const role = useAuiState((state) => state.message.role)
    const status = useAuiState((state) => state.message.status)
    const ToolRenderer = useCallback(
        (part: ToolCallMessagePartProps) => (
            <ToolPart part={part} onOpenLocation={onOpenLocation} onShowDiff={onShowDiff}/>
        ),
        [onOpenLocation, onShowDiff],
    )

    if (role === "user") {
        return (
            <MessagePrimitive.Root className="chat-message user">
                <MessagePrimitive.Parts components={{Text: UserText}}/>
            </MessagePrimitive.Root>
        )
    }

    return (
        <MessagePrimitive.Root className={`chat-message ${role}`}>
            <div className="assistant-content">
                <MessagePrimitive.Parts
                    components={{
                        Text: MarkdownText,
                        Reasoning: ReasoningPart,
                        tools: {Fallback: ToolRenderer},
                        data: {by_name: {"vibefly-notice": NoticePart}},
                    }}
                />
                {status?.type === "running" ? <span className="streaming-caret"/> : null}
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
            remarkPlugins={[remarkBreaks]}
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
    return (
        <div className={`thinking-block ${open ? "open" : ""}`}>
            <button className="thinking-toggle" onClick={() => setOpen((value) => !value)}>
                <Brain size={15}/>
                <span>{t("chat:reasoning")}</span>
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

function ToolPart({
                      part,
                      onOpenLocation,
                      onShowDiff,
                  }: {
    part: ToolCallMessagePartProps
    onOpenLocation: (path: string, line?: number) => void
    onShowDiff: (path: string) => void
}) {
    const {t} = useAppTranslation("chat")
    const [expanded, setExpanded] = useState(false)
    const artifact = (part.artifact ?? {}) as ToolArtifact
    const status = artifact.status ?? (part.result === undefined ? "running" : "completed")
    const location = artifact.locations?.[0]
    return (
        <div className={`tool-part ${status === "failed" ? "failed" : ""}`}>
            <button className="tool-summary" onClick={() => setExpanded((value) => !value)}>
                <span className="tool-icon">
                    {status === "running" || status === "pending" ? (
                        <LoaderCircle size={13} className="spin"/>
                    ) : status === "failed" ? (
                        <AlertTriangle size={13}/>
                    ) : (
                        <Check size={13}/>
                    )}
                </span>
                <Wrench size={14}/>
                <strong>{part.toolName}</strong>
                {location ? (
                    <span
                        className="tool-path"
                        title={location.path}
                        onClick={(event) => {
                            event.stopPropagation()
                            onOpenLocation(location.path, location.line)
                        }}
                    >
                        {location.path}
                    </span>
                ) : null}
                {artifact.output && !expanded ? (
                    <span className="tool-result-short">{artifact.output.split("\n", 1)[0]}</span>
                ) : null}
                {(part.toolName === "edit" || part.toolName === "write") && location ? (
                    <span
                        className="tool-diff"
                        role="button"
                        title={t("chat:showDiff")}
                        onClick={(event) => {
                            event.stopPropagation()
                            onShowDiff(location.path)
                        }}
                    >
                        <GitCompareArrows size={13}/>
                    </span>
                ) : null}
                <ChevronDown size={14} className={expanded ? "rotated" : ""}/>
            </button>
            {expanded ? (
                <div className="tool-detail">
                    {part.argsText ? <pre>{formatJson(part.argsText)}</pre> : null}
                    {artifact.output ? <pre>{artifact.output}</pre> : null}
                </div>
            ) : null}
        </div>
    )
}

function formatJson(value: string): string {
    try {
        return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
        return value
    }
}
