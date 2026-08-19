import type {ChatSessionSummary, RecentChatSession} from "@vibefly/uiagent-shared"
import {ChevronsUpDown, MessageSquareText, Plus, Settings2, ShieldCheck, X,} from "lucide-react"
import {type RefObject, useCallback, useEffect, useRef, useState} from "react"

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,} from "@/components/ui/context-menu"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,} from "@/components/ui/tooltip"
import {useAppTranslation} from "../i18n"
import {AssistantChat} from "./AssistantChat"
import {type ChatController, useChatController} from "./useChatController"

export function ChatPage() {
    const controller = useChatController()
    return <ChatPageView controller={controller}/>
}

type HiddenTabs = {
    left: ChatSessionSummary[]
    right: ChatSessionSummary[]
}

function measureHiddenTabs(
    container: HTMLElement,
    tabs: { summary: ChatSessionSummary }[],
): HiddenTabs {
    const containerRect = container.getBoundingClientRect()
    const left: ChatSessionSummary[] = []
    const right: ChatSessionSummary[] = []
    for (const tab of tabs) {
        const node = container.querySelector<HTMLElement>(
            `[data-session-id="${CSS.escape(tab.summary.sessionId)}"]`,
        )
        if (!node) continue
        const rect = node.getBoundingClientRect()
        const width = rect.width
        if (width <= 0) continue
        const visibleLeft = Math.max(rect.left, containerRect.left)
        const visibleRight = Math.min(rect.right, containerRect.right)
        const visibleWidth = Math.max(0, visibleRight - visibleLeft)
        // Treat as hidden when less than half of the tab is in view.
        if (visibleWidth / width >= 0.5) continue
        const tabCenter = (rect.left + rect.right) / 2
        const containerCenter = (containerRect.left + containerRect.right) / 2
        if (tabCenter < containerCenter) left.push(tab.summary)
        else right.push(tab.summary)
    }
    return {left, right}
}

function ChatPageView({controller}: { controller: ChatController }) {
    const {t} = useAppTranslation("chat")
    const dragSessionIdRef = useRef<string | null>(null)
    const tabsRef = useRef<HTMLDivElement>(null)
    const tabsListTriggerRef = useRef<HTMLButtonElement>(null)
    const tabsListMenuRef = useRef<HTMLDivElement>(null)
    const [tabsListOpen, setTabsListOpen] = useState(false)
    const [hiddenTabs, setHiddenTabs] = useState<HiddenTabs>({left: [], right: []})
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
    const canCloseOthers = controller.tabs.length > 1
    const hasHiddenTabs = hiddenTabs.left.length > 0 || hiddenTabs.right.length > 0

    const refreshHiddenTabs = useCallback(() => {
        const el = tabsRef.current
        if (!el) {
            setHiddenTabs({left: [], right: []})
            return
        }
        setHiddenTabs(measureHiddenTabs(el, controller.tabs))
    }, [controller.tabs])

    const scrollTabIntoView = useCallback((sessionId: string, behavior: ScrollBehavior = "smooth") => {
        const container = tabsRef.current
        if (!container || !sessionId) return

        const align = () => {
            const tab = container.querySelector<HTMLElement>(
                `[data-session-id="${CSS.escape(sessionId)}"]`,
            )
            if (!tab) return false
            const cRect = container.getBoundingClientRect()
            const tRect = tab.getBoundingClientRect()
            let delta = 0
            if (tRect.left < cRect.left + 2) {
                delta = tRect.left - cRect.left - 8
            } else if (tRect.right > cRect.right - 2) {
                delta = tRect.right - cRect.right + 8
            }
            if (delta !== 0) {
                container.scrollTo({left: container.scrollLeft + delta, behavior})
            }
            refreshHiddenTabs()
            return true
        }

        if (align()) return
        // Newly opened tabs may not be mounted yet.
        requestAnimationFrame(() => {
            if (align()) return
            requestAnimationFrame(() => {
                align()
            })
        })
    }, [refreshHiddenTabs])

    const selectTabFromList = useCallback((sessionId: string) => {
        setTabsListOpen(false)
        void actions.activate(sessionId).then(() => {
            scrollTabIntoView(sessionId)
        })
    }, [actions, scrollTabIntoView])

    const openRecentSession = useCallback(async (session: RecentChatSession) => {
        if (!activeTab) return
        await actions.openRecent(session, {replaceSessionId: activeTab.summary.sessionId})
        scrollTabIntoView(session.sessionId)
    }, [actions, activeTab, scrollTabIntoView])

    useEffect(() => {
        const el = tabsRef.current
        if (!el) return
        refreshHiddenTabs()
        const observer = new ResizeObserver(() => refreshHiddenTabs())
        observer.observe(el)
        el.addEventListener("scroll", refreshHiddenTabs, {passive: true})
        window.addEventListener("resize", refreshHiddenTabs)
        const onWheel = (event: WheelEvent) => {
            if (el.scrollWidth <= el.clientWidth) return
            const dominant = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
            if (dominant === 0) return
            el.scrollLeft += dominant
            event.preventDefault()
            refreshHiddenTabs()
        }
        el.addEventListener("wheel", onWheel, {passive: false})
        return () => {
            observer.disconnect()
            el.removeEventListener("scroll", refreshHiddenTabs)
            el.removeEventListener("wheel", onWheel)
            window.removeEventListener("resize", refreshHiddenTabs)
        }
    }, [refreshHiddenTabs, controller.tabs.length])

    useEffect(() => {
        if (!controller.activeId) return
        scrollTabIntoView(controller.activeId)
    }, [controller.activeId, controller.tabs.length, scrollTabIntoView])

    useEffect(() => {
        if (!hasHiddenTabs && tabsListOpen) setTabsListOpen(false)
    }, [hasHiddenTabs, tabsListOpen])

    useEffect(() => {
        if (!tabsListOpen) return
        const onPointerDown = (event: PointerEvent) => {
            if (!(event.target instanceof Node)) return
            if (tabsListTriggerRef.current?.contains(event.target)) return
            if (tabsListMenuRef.current?.contains(event.target)) return
            setTabsListOpen(false)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return
            setTabsListOpen(false)
        }
        document.addEventListener("pointerdown", onPointerDown)
        document.addEventListener("keydown", onKeyDown)
        return () => {
            document.removeEventListener("pointerdown", onPointerDown)
            document.removeEventListener("keydown", onKeyDown)
        }
    }, [tabsListOpen])

    return (
        <TooltipProvider delayDuration={350}>
        <main className="chat-app">
            <header className="session-bar">
                <div className="session-tabs-wrap">
                    <div ref={tabsRef} className="session-tabs" role="tablist">
                        {controller.tabs.map((tab) => (
                            <ContextMenu key={tab.summary.sessionId}>
                                <ContextMenuTrigger asChild>
                                    <button
                                        className={`session-tab${tab.summary.sessionId === controller.activeId ? " active" : ""}${tab.summary.unread ? " unread" : ""}`}
                                        role="tab"
                                        data-session-id={tab.summary.sessionId}
                                        aria-selected={tab.summary.sessionId === controller.activeId}
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
                                        onAuxClick={(event) => {
                                            if (event.button !== 1) return
                                            event.preventDefault()
                                            void actions.closeSession(tab.summary.sessionId)
                                        }}
                                    >
                                        <TruncatedText className="session-title" text={tab.summary.title}/>
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
                                </ContextMenuTrigger>
                                <ContextMenuContent>
                                    <ContextMenuItem
                                        onSelect={() => void actions.closeSession(tab.summary.sessionId)}
                                    >
                                        {t("chat:closeSession")}
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                        disabled={!canCloseOthers}
                                        onSelect={() => void actions.closeOtherSessions(tab.summary.sessionId)}
                                    >
                                        {t("chat:closeOtherSessions")}
                                    </ContextMenuItem>
                                </ContextMenuContent>
                            </ContextMenu>
                        ))}
                    </div>
                    {hasHiddenTabs ? (
                        <button
                            ref={tabsListTriggerRef}
                            type="button"
                            className={`session-tabs-list-button${tabsListOpen ? " open" : ""}`}
                            title={t("chat:showTabsList")}
                            aria-label={t("chat:showTabsList")}
                            aria-expanded={tabsListOpen}
                            onClick={() => {
                                refreshHiddenTabs()
                                setTabsListOpen((open) => !open)
                            }}
                        >
                            <ChevronsUpDown size={14} strokeWidth={2}/>
                        </button>
                    ) : null}
                    {tabsListOpen ? (
                        <TabsListMenu
                            menuRef={tabsListMenuRef}
                            left={hiddenTabs.left}
                            right={hiddenTabs.right}
                            activeId={controller.activeId}
                            onSelect={selectTabFromList}
                            onClose={(sessionId) => {
                                void actions.closeSession(sessionId).then(() => {
                                    requestAnimationFrame(refreshHiddenTabs)
                                })
                            }}
                        />
                    ) : null}
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
                    store={controller.settingStore}
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
                    recent={controller.recent}
                    onRefreshRecent={actions.refreshRecent}
                    onOpenRecent={openRecentSession}
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
        </TooltipProvider>
    )
}

function TabsListItem({
                          tab,
                          active,
                          onSelect,
                          onClose,
                          closeLabel,
                      }: {
    tab: ChatSessionSummary
    active: boolean
    onSelect: (sessionId: string) => void
    onClose: (sessionId: string) => void
    closeLabel: string
}) {
    return (
        <div className={`tabs-list-item${active ? " active" : ""}${tab.unread ? " unread" : ""}`}>
            <button
                type="button"
                className="tabs-list-item-main"
                onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onSelect(tab.sessionId)
                }}
            >
                <TruncatedText className="tabs-list-item-title" text={tab.title}/>
            </button>
            <button
                type="button"
                className="tabs-list-item-close"
                title={closeLabel}
                aria-label={closeLabel}
                onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onClose(tab.sessionId)
                }}
            >
                <X size={13} strokeWidth={1.8}/>
            </button>
        </div>
    )
}

function TabsListMenu({
                          menuRef,
                          left,
                          right,
                          activeId,
                          onSelect,
                          onClose,
                      }: {
    menuRef: RefObject<HTMLDivElement | null>
    left: ChatSessionSummary[]
    right: ChatSessionSummary[]
    activeId: string | null
    onSelect: (sessionId: string) => void
    onClose: (sessionId: string) => void
}) {
    const {t} = useAppTranslation("chat")
    const closeLabel = t("chat:closeSession")
    return (
        <div
            ref={menuRef}
            className="tabs-list-menu"
            onPointerDown={(event) => event.stopPropagation()}
        >
            {left.map((tab) => (
                <TabsListItem
                    key={tab.sessionId}
                    tab={tab}
                    active={tab.sessionId === activeId}
                    onSelect={onSelect}
                    onClose={onClose}
                    closeLabel={closeLabel}
                />
            ))}
            {left.length > 0 && right.length > 0 ? (
                <div className="tabs-list-separator" role="separator"/>
            ) : null}
            {right.map((tab) => (
                <TabsListItem
                    key={tab.sessionId}
                    tab={tab}
                    active={tab.sessionId === activeId}
                    onSelect={onSelect}
                    onClose={onClose}
                    closeLabel={closeLabel}
                />
            ))}
        </div>
    )
}

function TruncatedText({className, text}: { className?: string; text: string }) {
    const ref = useRef<HTMLSpanElement>(null)
    const [open, setOpen] = useState(false)

    const isTruncated = useCallback(() => {
        const el = ref.current
        if (!el) return false
        return el.scrollWidth > el.clientWidth + 1
    }, [])

    return (
        <Tooltip
            open={open}
            onOpenChange={(next) => {
                setOpen(next && isTruncated())
            }}
        >
            <TooltipTrigger asChild>
                <span ref={ref} className={className}>
                    {text}
                </span>
            </TooltipTrigger>
            <TooltipContent
                side="bottom"
                sideOffset={8}
                className="z-[100] max-w-[min(360px,calc(100vw-24px))] break-words"
            >
                {text}
            </TooltipContent>
        </Tooltip>
    )
}
