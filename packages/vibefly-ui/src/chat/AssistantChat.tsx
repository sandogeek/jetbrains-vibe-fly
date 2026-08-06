import {
    type AppendMessage,
    AssistantRuntimeProvider,
    AuiIf,
    ComposerPrimitive,
    ThreadPrimitive,
    useExternalStoreRuntime,
} from "@assistant-ui/react"
import type {ChatContextItem, ChatMessage, ToolPermissionDecision} from "@vibefly/uiagent-shared"
import {
    AlertTriangle,
    ChevronDown,
    CircleStop,
    FileCode2,
    MessageSquareText,
    Paperclip,
    Send,
    ShieldCheck,
    Sparkles,
    X,
} from "lucide-react"
import {type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState} from "react"

import {convertChatMessage} from "../chatMessageAdapter"
import type {ModelPreferencesDto} from "../generated/rpc"
import {useAppTranslation} from "../i18n"
import {ModelPicker, type ModelPickerOption} from "../settings/ModelPicker"
import {ChatMessageActionsContext, ChatMessageView} from "./MessageParts"
import type {ChatTab, PendingInput, PendingPermission, ThinkingOption} from "./types"

/** Stable identity — inline children remount on every stream tick. */
const renderThreadMessage = () => <ChatMessageView/>

export type AssistantChatProps = {
    tab: ChatTab
    draft: string
    contexts: ChatContextItem[]
    modelOptions: ModelPickerOption[]
    modelPreferences: ModelPreferencesDto
    thinkingOptions: ThinkingOption[]
    busy: boolean
    queued: boolean
    connected: boolean
    offline: boolean
    error: string | null
    pendingPermission: PendingPermission | null
    pendingInput: PendingInput | null
    inputReply: string
    onInputReplyChange: (value: string) => void
    onRespondPermission: (decision: ToolPermissionDecision) => void
    onRespondInput: (cancelled?: boolean) => void
    onDismissError: () => void
    onDraftChange: (value: string) => void
    onSend: (text: string) => Promise<void>
    onCancel: () => Promise<void>
    onChooseContextFiles: () => Promise<void>
    onRemoveContext: (contextId: string) => void
    onModelChange: (spec: string, pinned: string[], recent: string[]) => void
    onThinkingChange: (level: string) => Promise<void>
    onOpenLocation: (path: string, line?: number) => void
    onShowDiff: (path: string) => void
    onOpenExternalUrl: (url: string) => void
}

function modelLabel(modelId: string | undefined, fallback: string): string {
    if (!modelId) return fallback
    const slash = modelId.indexOf("/")
    return slash >= 0 ? modelId.slice(slash + 1) : modelId
}

export function AssistantChat(props: AssistantChatProps) {
    const {t} = useAppTranslation("chat")
    const running = props.busy || props.queued
    const runtime = useExternalStoreRuntime<ChatMessage>({
        messages: props.tab.messages,
        convertMessage: convertChatMessage,
        isRunning: running,
        isSendDisabled: running || (!props.offline && !props.connected),
        onNew: async (message: AppendMessage) => {
            const text = message.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("")
            await props.onSend(text)
        },
        onCancel: props.onCancel,
    })

    useEffect(() => {
        if (runtime.thread.composer.getState().text !== props.draft) {
            runtime.thread.composer.setText(props.draft)
        }
    }, [props.draft, runtime])

    const onMarkdownClick = (event: ReactMouseEvent<HTMLElement>) => {
        const anchor = (event.target as HTMLElement).closest("a")
        const href = anchor?.getAttribute("href")
        if (!href) return
        event.preventDefault()
        if (/^https?:\/\//i.test(href)) props.onOpenExternalUrl(href)
    }

    const messageActions = useMemo(
        () => ({
            onOpenLocation: props.onOpenLocation,
            onShowDiff: props.onShowDiff,
        }),
        [props.onOpenLocation, props.onShowDiff],
    )

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <ChatMessageActionsContext.Provider value={messageActions}>
            <ThreadPrimitive.Root className="assistant-thread">
                <ThreadPrimitive.Viewport
                    className="conversation assistant-viewport"
                    autoScroll
                    onClick={onMarkdownClick}
                >
                    <div className="message-stream">
                        <AuiIf condition={(s) => s.thread.isEmpty}>
                            <div className="new-session-state">
                                <div className="new-session-mark">
                                    <Sparkles size={22}/>
                                </div>
                                <h1>{t("chat:startSession")}</h1>
                                <p>{modelLabel(props.tab.summary.modelId, t("chat:defaultModel"))}</p>
                            </div>
                        </AuiIf>
                        <ThreadPrimitive.Messages>
                            {renderThreadMessage}
                        </ThreadPrimitive.Messages>

                        {props.pendingPermission ? (
                            <PermissionCard
                                pending={props.pendingPermission}
                                onRespond={props.onRespondPermission}
                                onOpenLocation={props.onOpenLocation}
                            />
                        ) : null}
                        {props.pendingInput ? (
                            <InputCard
                                pending={props.pendingInput}
                                value={props.inputReply}
                                onChange={props.onInputReplyChange}
                                onRespond={props.onRespondInput}
                            />
                        ) : null}
                    </div>
                </ThreadPrimitive.Viewport>
            </ThreadPrimitive.Root>

            {props.error ? (
                <div className="error-banner">
                    <AlertTriangle size={15}/>
                    <span>{props.error}</span>
                    <button
                        className="icon-button"
                        title={t("common:dismiss")}
                        onClick={props.onDismissError}
                    >
                        <X size={14}/>
                    </button>
                </div>
            ) : null}

            <ComposerPrimitive.Root className="composer-shell">
                {props.contexts.length > 0 ? (
                    <div className="context-list">
                        {props.contexts.map((context) => (
                            <span key={context.id} className="context-chip" title={context.path}>
                                <FileCode2 size={13}/>
                                <span>{context.path}</span>
                                <button
                                    type="button"
                                    title={t("chat:removeContext")}
                                    onClick={() => props.onRemoveContext(context.id)}
                                >
                                    <X size={12}/>
                                </button>
                            </span>
                        ))}
                    </div>
                ) : null}
                <ComposerPrimitive.Input
                    className="composer-input"
                    placeholder={t("chat:typeMessage")}
                    submitMode="enter"
                    onChange={(event) => props.onDraftChange(event.currentTarget.value)}
                />
                <div className="composer-toolbar">
                    <div className="composer-selectors">
                        <button
                            type="button"
                            className="toolbar-button"
                            title={t("chat:addFileContext")}
                            disabled={props.offline}
                            onClick={() => void props.onChooseContextFiles()}
                        >
                            <Paperclip size={15}/>
                        </button>
                        <div className="composer-select-group">
                            <ModelPicker
                                options={props.modelOptions}
                                value={props.tab.summary.modelId ?? ""}
                                pinnedSpecs={props.modelPreferences.pinnedModelSpecs ?? []}
                                recentSpecs={props.modelPreferences.recentModelSpecs ?? []}
                                variant="compact"
                                placeholder={t("chat:defaultModel")}
                                ariaLabel={t("chat:model")}
                                disabled={running || props.offline}
                                onChange={props.onModelChange}
                            />
                            <ThinkingSelect
                                value={props.tab.summary.thinkingLevel ?? "off"}
                                options={props.thinkingOptions}
                                ariaLabel={t("chat:thinkingLevel")}
                                disabled={running || props.offline}
                                onChange={(level) => void props.onThinkingChange(level)}
                            />
                        </div>
                    </div>
                    <div className="composer-actions">
                        {running ? (
                            <ComposerPrimitive.Cancel
                                className="stop-button"
                                title={props.queued ? t("chat:cancelQueued") : t("chat:stop")}
                            >
                                <CircleStop size={16}/>
                            </ComposerPrimitive.Cancel>
                        ) : (
                            <ComposerPrimitive.Send className="send-button" title={t("chat:send")}>
                                <Send size={15}/>
                            </ComposerPrimitive.Send>
                        )}
                    </div>
                </div>
            </ComposerPrimitive.Root>
            </ChatMessageActionsContext.Provider>
        </AssistantRuntimeProvider>
    )
}

function PermissionCard({
                            pending,
                            onRespond,
                            onOpenLocation,
                        }: {
    pending: PendingPermission
    onRespond: (decision: ToolPermissionDecision) => void
    onOpenLocation: (path: string, line?: number) => void
}) {
    const {t} = useAppTranslation("chat")
    return (
        <div className="interaction-card permission-card">
            <div className="interaction-heading">
                <ShieldCheck size={17}/>
                <span>{t("chat:toolApproval")}</span>
            </div>
            <strong>{pending.request.title}</strong>
            {pending.request.command ? (
                <pre className="permission-command">$ {pending.request.command}</pre>
            ) : null}
            {pending.request.locations?.map((location) => (
                <button
                    key={`${location.path}:${location.line ?? ""}`}
                    className="file-link"
                    onClick={() => onOpenLocation(location.path, location.line)}
                >
                    <FileCode2 size={13}/> {location.path}
                </button>
            ))}
            <div className="permission-actions">
                <button className="secondary-button" onClick={() => onRespond("reject_once")}>
                    {t("common:reject")}
                </button>
                <button className="secondary-button" onClick={() => onRespond("reject_always")}>
                    {t("chat:alwaysReject")}
                </button>
                <button className="secondary-button" onClick={() => onRespond("allow_always")}>
                    {t("chat:alwaysAllow")}
                </button>
                <button className="primary-button" onClick={() => onRespond("allow_once")}>
                    {t("chat:allowOnce")}
                </button>
            </div>
        </div>
    )
}

function InputCard({
                       pending,
                       value,
                       onChange,
                       onRespond,
                   }: {
    pending: PendingInput
    value: string
    onChange: (value: string) => void
    onRespond: (cancelled?: boolean) => void
}) {
    const {t} = useAppTranslation("chat")
    return (
        <div className="interaction-card input-card">
            <div className="interaction-heading">
                <MessageSquareText size={17}/>
                <span>{t("chat:agentNeedsInput")}</span>
            </div>
            <p>{pending.request.prompt}</p>
            <textarea
                value={value}
                placeholder={pending.request.placeholder}
                onChange={(event) => onChange(event.currentTarget.value)}
            />
            <div className="permission-actions">
                <button className="secondary-button" onClick={() => onRespond(true)}>
                    {t("common:cancel")}
                </button>
                <button className="primary-button" onClick={() => onRespond(false)}>
                    {t("common:submit")}
                </button>
            </div>
        </div>
    )
}

function ThinkingSelect({
                            value,
                            options,
                            ariaLabel,
                            disabled,
                            onChange,
                        }: {
    value: string
    options: ThinkingOption[]
    ariaLabel: string
    disabled?: boolean
    onChange: (level: string) => void
}) {
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const selected = options.find((option) => option.value === value) ?? options[0]

    useEffect(() => {
        if (!open) return
        const onPointerDown = (event: PointerEvent) => {
            if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) {
                setOpen(false)
            }
        }
        document.addEventListener("pointerdown", onPointerDown)
        return () => document.removeEventListener("pointerdown", onPointerDown)
    }, [open])

    useEffect(() => {
        if (disabled) setOpen(false)
    }, [disabled])

    return (
        <div ref={rootRef} className="composer-thinking-picker">
            <button
                type="button"
                className="composer-select-trigger composer-thinking-select"
                aria-label={ariaLabel}
                aria-expanded={open}
                disabled={disabled}
                onClick={() => setOpen((current) => !current)}
            >
                <span>{selected?.label ?? value}</span>
                <ChevronDown size={12} strokeWidth={2} className={`composer-select-chevron ${open ? "" : "rotated"}`}/>
            </button>
            {open ? (
                <div className="composer-thinking-menu" role="listbox" aria-label={ariaLabel}>
                    {options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            role="option"
                            aria-selected={option.value === value}
                            className={`composer-thinking-option ${option.value === value ? "selected" : ""}`}
                            onClick={() => {
                                onChange(option.value)
                                setOpen(false)
                            }}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    )
}
