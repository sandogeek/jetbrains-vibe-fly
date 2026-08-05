import type {ChatSessionSummary, RecentChatSession} from "@vibefly/uiagent-shared"
import {
    AlertTriangle,
    Clock3,
    History,
    LoaderCircle,
    MessageSquareText,
    Plus,
    Settings2,
    ShieldCheck,
    X,
} from "lucide-react"
import {type RefObject, useEffect, useRef, useState} from "react"

import {useAppTranslation} from "../i18n"
import {AssistantChat} from "./AssistantChat"
import {type ChatController, useChatController} from "./useChatController"

type TabContextMenuState = {
    sessionId: string
    x: number
    y: number
}

export function ChatPage() {
    const controller = useChatController()
    return <ChatPageView controller={controller}/>
}

function ChatPageView({controller}: { controller: ChatController }) {
    const {t} = useAppTranslation("chat")
    const dragSessionIdRef = useRef<string | null>(null)
    const recentTriggerRef = useRef<HTMLButtonElement>(null)
    const recentMenuRef = useRef<HTMLDivElement>(null)
    const tabContextMenuRef = useRef<HTMLDivElement>(null)
    const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null)
    const {actions} = controller
    const activeTab = controller.activeTab
    const backgroundPermission =
        controller.pendingPermission?.request.sessionId !== controller.activeId
            ? controller.pendingPermission
            : null
    const backgroundInput =
        controller.pendingInput?.request.sessionId !== controller.activeId
            ? controller.pendingInput
            : null
    const canCloseOthers =
        !!tabContextMenu &&
        controller.tabs.some((tab) => tab.summary.sessionId !== tabContextMenu.sessionId)

    useEffect(() => {
        if (!controller.recentOpen) return
        const onPointerDown = (event: PointerEvent) => {
            if (!(event.target instanceof Node)) return
            if (recentTriggerRef.current?.contains(event.target)) return
            if (recentMenuRef.current?.contains(event.target)) return
            actions.closeRecent()
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") actions.closeRecent()
        }
        document.addEventListener("pointerdown", onPointerDown)
        document.addEventListener("keydown", onKeyDown)
        return () => {
            document.removeEventListener("pointerdown", onPointerDown)
            document.removeEventListener("keydown", onKeyDown)
        }
    }, [controller.recentOpen, actions.closeRecent])

    useEffect(() => {
        if (!tabContextMenu) return
        const onPointerDown = (event: PointerEvent) => {
            if (!(event.target instanceof Node)) return
            if (tabContextMenuRef.current?.contains(event.target)) return
            setTabContextMenu(null)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setTabContextMenu(null)
        }
        const onScroll = () => setTabContextMenu(null)
        document.addEventListener("pointerdown", onPointerDown)
        document.addEventListener("keydown", onKeyDown)
        window.addEventListener("scroll", onScroll, true)
        return () => {
            document.removeEventListener("pointerdown", onPointerDown)
            document.removeEventListener("keydown", onKeyDown)
            window.removeEventListener("scroll", onScroll, true)
        }
    }, [tabContextMenu])

    return (
        <main className="chat-app">
            <header className="session-bar">
                <div className="session-tabs" role="tablist">
                    {controller.tabs.map((tab) => (
                        <button
                            key={tab.summary.sessionId}
                            className={`session-tab ${tab.summary.sessionId === controller.activeId ? "active" : ""}`}
                            role="tab"
                            aria-selected={tab.summary.sessionId === controller.activeId}
                            title={tab.summary.title}
                            draggable
                            onDragStart={() => {
                                dragSessionIdRef.current = tab.summary.sessionId
                            }}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => {
                                if (dragSessionIdRef.current) {
                                    actions.reorderTabs(dragSessionIdRef.current, tab.summary.sessionId)
                                }
                                dragSessionIdRef.current = null
                            }}
                            onClick={() => void actions.activate(tab.summary.sessionId)}
                            onContextMenu={(event) => {
                                event.preventDefault()
                                setTabContextMenu({
                                    sessionId: tab.summary.sessionId,
                                    x: event.clientX,
                                    y: event.clientY,
                                })
                            }}
                        >
                            <StatusDot state={tab.summary.state} unread={tab.summary.unread}/>
                            <span className="session-title">{tab.summary.title}</span>
                            {tab.summary.queuePosition ? (
                                <span className="queue-badge">{tab.summary.queuePosition}</span>
                            ) : null}
                            <span
                                className="tab-close"
                                role="button"
                                title={t("chat:closeSession")}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    void actions.closeSession(tab.summary.sessionId)
                                }}
                            >
                                <X size={13} strokeWidth={1.8}/>
                            </span>
                        </button>
                    ))}
                </div>
                <div className="session-actions">
                    <button
                        className="icon-button"
                        title={t("chat:newSession")}
                        onClick={() => void actions.newSession()}
                    >
                        <Plus size={17}/>
                    </button>
                    <button
                        ref={recentTriggerRef}
                        className="icon-button"
                        title={t("chat:recentSessions")}
                        onClick={() => void actions.refreshRecent()}
                    >
                        <History size={16}/>
                    </button>
                    <button
                        className="icon-button"
                        title={t("chat:openSettings")}
                        onClick={actions.openSettings}
                    >
                        <Settings2 size={16}/>
                    </button>
                    <span
                        className={`connection-dot ${controller.agentStatus === "ready" ? "ready" : ""} ${controller.offline ? "offline" : ""}`}
                        title={`${controller.hostStatus} / ${controller.agentStatus}`}
                    />
                </div>
                {controller.recentOpen ? (
                    <RecentMenu
                        menuRef={recentMenuRef}
                        recent={controller.recent}
                        onOpen={actions.openRecent}
                    />
                ) : null}
                {tabContextMenu ? (
                    <div
                        ref={tabContextMenuRef}
                        className="tab-context-menu"
                        style={{left: tabContextMenu.x, top: tabContextMenu.y}}
                        role="menu"
                    >
                        <button
                            className="tab-context-item"
                            role="menuitem"
                            onClick={() => {
                                const sessionId = tabContextMenu.sessionId
                                setTabContextMenu(null)
                                void actions.closeSession(sessionId)
                            }}
                        >
                            {t("chat:closeSession")}
                        </button>
                        <button
                            className="tab-context-item"
                            role="menuitem"
                            disabled={!canCloseOthers}
                            onClick={() => {
                                if (!canCloseOthers) return
                                const sessionId = tabContextMenu.sessionId
                                setTabContextMenu(null)
                                void actions.closeOtherSessions(sessionId)
                            }}
                        >
                            {t("chat:closeOtherSessions")}
                        </button>
                    </div>
                ) : null}
            </header>

            {backgroundPermission ? (
                <button
                    className="attention-bar"
                    onClick={() => void actions.activate(backgroundPermission.request.sessionId)}
                >
                    <ShieldCheck size={15}/>
                    <span>{t("chat:backgroundPermission")}</span>
                    <span>{t("common:open")}</span>
                </button>
            ) : null}
            {backgroundInput ? (
                <button
                    className="attention-bar"
                    onClick={() => void actions.activate(backgroundInput.request.sessionId)}
                >
                    <MessageSquareText size={15}/>
                    <span>{t("chat:backgroundInput")}</span>
                    <span>{t("common:open")}</span>
                </button>
            ) : null}

            {activeTab ? (
                <AssistantChat
                    key={activeTab.summary.sessionId}
                    tab={activeTab}
                    draft={controller.activeDraft}
                    contexts={controller.activeContexts}
                    modelOptions={controller.activeModelOptions}
                    modelPreferences={controller.modelPreferences}
                    thinkingOptions={controller.thinkingOptions}
                    busy={controller.busy}
                    queued={controller.queued}
                    connected={controller.connected}
                    offline={controller.offline}
                    error={controller.error}
                    pendingPermission={
                        controller.pendingPermission?.request.sessionId === activeTab.summary.sessionId
                            ? controller.pendingPermission
                            : null
                    }
                    pendingInput={
                        controller.pendingInput?.request.sessionId === activeTab.summary.sessionId
                            ? controller.pendingInput
                            : null
                    }
                    inputReply={controller.inputReply}
                    onInputReplyChange={actions.setInputReply}
                    onRespondPermission={actions.respondPermission}
                    onRespondInput={actions.respondInput}
                    onDismissError={actions.dismissError}
                    onDraftChange={(value) => actions.setDraft(activeTab.summary.sessionId, value)}
                    onSend={(text) => actions.sendMessage(activeTab.summary.sessionId, text)}
                    onCancel={() => actions.stopOrCancel(activeTab.summary.sessionId)}
                    onChooseContextFiles={actions.chooseContextFiles}
                    onRemoveContext={(contextId) =>
                        actions.removeContext(activeTab.summary.sessionId, contextId)
                    }
                    onModelChange={actions.onChatModelChange}
                    onThinkingChange={actions.setThinking}
                    onOpenLocation={actions.openLocation}
                    onShowDiff={actions.showDiff}
                    onOpenExternalUrl={actions.openExternalUrl}
                />
            ) : (
                <section className="conversation">
                    <div className="empty-state loading-session-state">
                        <div className="shimmer-container loading-session-skeleton">
                            <div className="shimmer shimmer-bg bg-muted/40 size-12 rounded-[14px]"/>
                            <div className="loading-session-lines">
                                <div className="shimmer shimmer-bg bg-muted/40 h-3.5 w-36 rounded"/>
                                <div className="shimmer shimmer-bg bg-muted/30 h-3 w-52 rounded"/>
                                <div className="shimmer shimmer-bg bg-muted/25 h-3 w-44 rounded"/>
                            </div>
                        </div>
                        <span className="shimmer text-muted/55 shimmer-color-accent shimmer-repeat-delay-800">
                            {t("chat:loadingSession")}
                        </span>
                    </div>
                </section>
            )}
        </main>
    )
}

function RecentMenu({
                        menuRef,
                        recent,
                        onOpen,
                    }: {
    menuRef: RefObject<HTMLDivElement | null>
    recent: RecentChatSession[]
    onOpen: (session: RecentChatSession) => Promise<void>
}) {
    const {t} = useAppTranslation("chat")
    return (
        <div ref={menuRef} className="recent-menu">
            <div className="recent-menu-title">{t("chat:recentSessions")}</div>
            {recent.length > 0 ? (
                recent.map((session) => (
                    <button
                        key={session.sessionId}
                        className="recent-item"
                        onClick={() => void onOpen(session)}
                    >
                        <MessageSquareText size={14}/>
                        <span>
                            <strong>{session.title}</strong>
                            <small>{new Date(session.updatedAt).toLocaleString()}</small>
                        </span>
                    </button>
                ))
            ) : (
                <div className="empty-menu">{t("chat:noRecent")}</div>
            )}
        </div>
    )
}

function StatusDot(props: { state: ChatSessionSummary["state"]; unread: boolean }) {
    return (
        <span className={`status-dot ${props.state} ${props.unread ? "unread" : ""}`}>
            {props.state === "running" ? <LoaderCircle size={12} className="spin"/> : null}
            {props.state === "queued" ? <Clock3 size={11}/> : null}
            {props.state === "waiting_permission" ? <ShieldCheck size={11}/> : null}
            {props.state === "waiting_input" ? <MessageSquareText size={11}/> : null}
            {props.state === "error" ? <AlertTriangle size={11}/> : null}
        </span>
    )
}
