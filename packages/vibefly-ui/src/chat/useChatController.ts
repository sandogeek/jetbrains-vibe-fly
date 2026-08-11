import type {SimpleRpcPeer} from "@sandogeek/simple-rpc"
import type {
    ChatContextItem,
    ChatEventBatch,
    ChatModelOption,
    RecentChatSession,
    ToolPermissionDecision,
    Ui2Agent,
} from "@vibefly/uiagent-shared"
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {applyUiLocale, i18n, useAppTranslation} from "../i18n"
import type {Ui2Host, Ui2HostChat} from "../generated/rpc"
import {log} from "../log"
import {type AgentStatus, connectAgentRpc} from "../rpc/agent"
import {createChatUiRpc} from "../rpc/client"
import {bindConsoleToHost} from "../rpc/console"
import type {ModelPickerOption} from "../settings/ModelPicker"
import {
    modelPreferenceMutations,
    settingsChanged as toSettingsChanged,
} from "../settings/hostSettings"
import {UiSettingsRuntime, useUiSettingsView} from "../settings/UiSettingsRuntime"
import type {ModelPreferences} from "../settings/settingsStore"
import {applyJbTheme} from "../theme"
import {applyChatEvent} from "./chatEventState"
import {createDemoTab} from "./demoSession"
import {type ChatContexts, type ChatTab, type PendingInput, type PendingPermission, type ThinkingOption,} from "./types"

type StateUpdater<T> = T | ((current: T) => T)

export type ChatController = {
    hostStatus: string
    agentStatus: AgentStatus
    tabs: ChatTab[]
    activeId: string
    activeTab: ChatTab | null
    recent: RecentChatSession[]
    recentOpen: boolean
    offline: boolean
    error: string | null
    activeDraft: string
    activeContexts: ChatContextItem[]
    activeModelOptions: ModelPickerOption[]
    modelPreferences: ModelPreferences
    thinkingOptions: ThinkingOption[]
    busy: boolean
    queued: boolean
    connected: boolean
    pendingPermission: PendingPermission | null
    pendingInput: PendingInput | null
    inputReply: string
    actions: {
        activate: (sessionId: string) => Promise<void>
        newSession: () => Promise<void>
        closeSession: (sessionId: string) => Promise<void>
        closeOtherSessions: (sessionId: string) => Promise<void>
        refreshRecent: () => Promise<void>
        closeRecent: () => void
        openRecent: (session: RecentChatSession) => Promise<void>
        reorderTabs: (draggedId: string, targetId: string) => void
        setDraft: (sessionId: string, value: string) => void
        sendMessage: (sessionId: string, text: string) => Promise<void>
        stopOrCancel: (sessionId?: string) => Promise<void>
        chooseContextFiles: () => Promise<void>
        removeContext: (sessionId: string, contextId: string) => void
        onChatModelChange: (spec: string, pinned: string[], recentModels: string[]) => void
        setThinking: (level: string) => Promise<void>
        respondPermission: (decision: ToolPermissionDecision) => void
        respondInput: (cancelInput?: boolean) => void
        setInputReply: (value: string) => void
        dismissError: () => void
        openSettings: () => void
        openLocation: (path: string, line?: number) => void
        showDiff: (path: string) => void
        openExternalUrl: (url: string) => void
    }
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function useChatController(): ChatController {
    const {t} = useAppTranslation("chat")
    const [hostStatus, setHostStatus] = useState("connecting")
    const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle")
    const [tabs, setTabs] = useState<ChatTab[]>([])
    const [activeId, setActiveId] = useState("")
    const [drafts, setDrafts] = useState<Record<string, string>>({})
    const [contexts, setContexts] = useState<ChatContexts>({})
    const [models, setModels] = useState<Record<string, ChatModelOption[]>>({})
    const [modelPreferences, setModelPreferences] = useState<ModelPreferences>({
        recentModelSpecs: [],
        pinnedModelSpecs: [],
    })
    const [recent, setRecent] = useState<RecentChatSession[]>([])
    const [recentOpen, setRecentOpen] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null)
    const [pendingInput, setPendingInput] = useState<PendingInput | null>(null)
    const [inputReply, setInputReply] = useState("")
    const [offline, setOffline] = useState(false)
    const [settingsStore, setSettingsStore] = useState<UiSettingsRuntime | null>(null)
    const settingsView = useUiSettingsView(settingsStore)

    const hostRef = useRef<Ui2Host | null>(null)
    const hostChatRef = useRef<Ui2HostChat | null>(null)
    const agentRef = useRef<Ui2Agent | null>(null)
    const projectRootRef = useRef("")
    const peerRef = useRef<SimpleRpcPeer | null>(null)
    const stopAgentRef = useRef<(() => void) | null>(null)
    const unbindConsoleRef = useRef<(() => void) | null>(null)
    const settingsRuntimeRef = useRef<UiSettingsRuntime | null>(null)
    const tabsRef = useRef<ChatTab[]>([])
    const activeIdRef = useRef("")
    const contextsRef = useRef<ChatContexts>({})
    const modelsRef = useRef<Record<string, ChatModelOption[]>>({})
    const offlineRef = useRef(false)
    const pendingPermissionRef = useRef<PendingPermission | null>(null)
    const pendingInputRef = useRef<PendingInput | null>(null)
    const modelFetchGenerationRef = useRef<Record<string, number>>({})

    const updateTabs = useCallback((update: StateUpdater<ChatTab[]>) => {
        const next = typeof update === "function" ? update(tabsRef.current) : update
        tabsRef.current = next
        setTabs(next)
    }, [])

    const updateActiveId = useCallback((sessionId: string) => {
        activeIdRef.current = sessionId
        setActiveId(sessionId)
    }, [])

    const updateContexts = useCallback((update: StateUpdater<ChatContexts>) => {
        const next = typeof update === "function" ? update(contextsRef.current) : update
        contextsRef.current = next
        setContexts(next)
    }, [])

    const updateModels = useCallback((update: StateUpdater<Record<string, ChatModelOption[]>>) => {
        const next = typeof update === "function" ? update(modelsRef.current) : update
        modelsRef.current = next
        setModels(next)
    }, [])

    const updateOffline = useCallback((value: boolean) => {
        offlineRef.current = value
        setOffline(value)
    }, [])

    const updatePendingPermission = useCallback((value: PendingPermission | null) => {
        pendingPermissionRef.current = value
        setPendingPermission(value)
    }, [])

    const updatePendingInput = useCallback((value: PendingInput | null) => {
        pendingInputRef.current = value
        setPendingInput(value)
    }, [])

    const loadModels = useCallback(
        async (sessionId: string, force = false) => {
            const chatAgent = agentRef.current
            if (!chatAgent || (!force && modelsRef.current[sessionId])) return
            const generation = (modelFetchGenerationRef.current[sessionId] ?? 0) + 1
            modelFetchGenerationRef.current[sessionId] = generation
            try {
                const options = await chatAgent.listChatModels(sessionId)
                if (modelFetchGenerationRef.current[sessionId] !== generation) return
                updateModels((current) => ({...current, [sessionId]: options}))
            } catch (modelError) {
                log.debug("model list unavailable", modelError)
            }
        },
        [updateModels],
    )

    const activeTab = useMemo(
        () => tabs.find((tab) => tab.summary.sessionId === activeId) ?? null,
        [activeId, tabs],
    )
    const activeContexts = contexts[activeId] ?? []
    const activeDraft = drafts[activeId] ?? ""
    const activeModelOptions = useMemo<ModelPickerOption[]>(
        () =>
            (models[activeId] ?? []).map((option) => ({
                spec: option.id,
                providerId: option.provider,
                modelId: option.model,
                modelLabel: option.label,
                reasoning: option.supportsThinking,
            })),
        [activeId, models],
    )
    const thinkingOptions = useMemo<ThinkingOption[]>(
        () => [
            {value: "off", label: t("chat:thinkingOff")},
            {value: "low", label: "Low"},
            {value: "medium", label: "Medium"},
            {value: "high", label: "High"},
            {value: "xhigh", label: "XHigh"},
            {value: "auto", label: "Auto"},
        ],
        [t],
    )
    const busy = ["running", "waiting_permission", "waiting_input"].includes(
        activeTab?.summary.state ?? "",
    )
    const queued = activeTab?.summary.state === "queued"

    const appendContexts = useCallback(
        (sessionId: string, incoming: ChatContextItem[]) => {
            if (!sessionId || incoming.length === 0) return
            updateContexts((current) => {
                const existing = current[sessionId] ?? []
                const keys = new Set(
                    existing.map(
                        (item) => `${item.kind}:${item.path}:${item.startLine ?? ""}:${item.endLine ?? ""}`,
                    ),
                )
                const added = incoming.filter((item) => {
                    const key = `${item.kind}:${item.path}:${item.startLine ?? ""}:${item.endLine ?? ""}`
                    if (!item.path || keys.has(key)) return false
                    keys.add(key)
                    return true
                })
                return {...current, [sessionId]: [...existing, ...added]}
            })
        },
        [updateContexts],
    )

    const applyBatch = useCallback(
        (batch: ChatEventBatch) => {
            for (const event of batch.events) {
                if (event.kind === "modelCatalogChanged") {
                    void loadModels(event.sessionId, true)
                    continue
                }
                const result = applyChatEvent(tabsRef.current, event, activeIdRef.current)
                updateTabs(result.tabs)
                if (result.effects.refreshPaths.length > 0) {
                    void hostChatRef.current?.refreshProjectFiles(result.effects.refreshPaths).catch(() => {
                    })
                }
                if (result.effects.error) setError(result.effects.error)
            }
        },
        [loadModels, updateTabs],
    )

    const loadModelPreferences = useCallback(async (ui2Host: Ui2Host) => {
        try {
            let runtime = settingsRuntimeRef.current
            if (!runtime) {
                runtime = new UiSettingsRuntime(ui2Host)
                settingsRuntimeRef.current = runtime
                setSettingsStore(runtime)
            }
            // Pin/MRU stay application-scoped while locale consumes project-effective settings.
            await runtime.start(true)
        } catch (preferencesError) {
            log.warn("model preferences unavailable", preferencesError)
        }
    }, [])

    useEffect(() => {
        if (!settingsView) return
        setModelPreferences(settingsView.settings.modelPreferences)
        applyUiLocale(settingsView.settings.ui.locale)
    }, [settingsView])

    const persistWorkspace = useCallback(async () => {
        const chatHost = hostChatRef.current
        if (!chatHost || offlineRef.current) return
        try {
            await chatHost.saveChatWorkspaceState({
                sessionIds: tabsRef.current.map((tab) => tab.summary.sessionId),
                activeSessionId: activeIdRef.current,
            })
        } catch (persistError) {
            log.debug("workspace state save failed", persistError)
        }
    }, [])

    const bootstrap = useCallback(
        async (ui2Host: Ui2Host, ui2HostChat: Ui2HostChat, isDisposed: () => boolean) => {
            try {
                await ui2Host.getAppVersion()
                await ui2HostChat.chatUiReady()
                projectRootRef.current = await ui2HostChat.getProjectRoot()
                const [workspace] = await Promise.all([
                    ui2HostChat.getChatWorkspaceState(),
                    loadModelPreferences(ui2Host),
                ])
                if (isDisposed()) return
                setHostStatus("connected")

                const connection = connectAgentRpc({
                    ui2HostChat,
                    isStopped: isDisposed,
                    onReady(proxy) {
                        agentRef.current = proxy
                    },
                    onStatus(status) {
                        setAgentStatus(status)
                    },
                    onChatEvents(batch) {
                        applyBatch(batch)
                    },
                    requestToolPermission(request) {
                        return new Promise((resolve) => {
                            updatePendingPermission({request, resolve})
                        })
                    },
                    requestUserInput(request) {
                        return new Promise((resolve) => {
                            setInputReply("")
                            updatePendingInput({request, resolve})
                        })
                    },
                })
                stopAgentRef.current = connection.stop

                const deadline = Date.now() + 30_000
                while (!agentRef.current && Date.now() < deadline && !isDisposed()) {
                    await new Promise((resolve) => setTimeout(resolve, 50))
                }
                if (!agentRef.current) throw new Error(i18n.t("chat:agentTimeout"))

                const restored: ChatTab[] = []
                for (const sessionId of workspace.sessionIds ?? []) {
                    try {
                        restored.push(
                            await agentRef.current.openChatSession({
                                projectRoot: projectRootRef.current,
                                sessionId,
                            }),
                        )
                    } catch (restoreError) {
                        log.warn("chat session restore failed", sessionId, restoreError)
                    }
                }
                if (restored.length === 0) {
                    const recentSessions = await agentRef.current.listRecentChatSessions({
                        projectRoot: projectRootRef.current,
                    })
                    setRecent(recentSessions)
                    for (const recentSession of recentSessions) {
                        try {
                            restored.push(
                                await agentRef.current.openChatSession({
                                    projectRoot: projectRootRef.current,
                                    sessionId: recentSession.sessionId,
                                    sessionFile: recentSession.sessionFile,
                                }),
                            )
                            break
                        } catch (restoreError) {
                            log.warn(
                                "recent chat session restore failed",
                                recentSession.sessionId,
                                restoreError,
                            )
                        }
                    }
                    if (restored.length === 0) {
                        restored.push(
                            await agentRef.current.createChatSession({
                                projectRoot: projectRootRef.current,
                            }),
                        )
                    }
                }
                if (isDisposed()) return
                updateTabs(restored)
                const savedActiveId = workspace.activeSessionId ?? ""
                const restoredActive = restored.some(
                    (tab) => tab.summary.sessionId === savedActiveId,
                )
                    ? savedActiveId
                    : restored[0]!.summary.sessionId
                updateActiveId(restoredActive)
                await loadModels(restoredActive)
                void persistWorkspace()
            } catch (bootstrapError) {
                if (isDisposed()) return
                const message = errorText(bootstrapError)
                log.error("chat bootstrap failed", message)
                setError(message)
                setHostStatus("error")
            }
        },
        [
            applyBatch,
            loadModelPreferences,
            loadModels,
            persistWorkspace,
            updateActiveId,
            updatePendingInput,
            updatePendingPermission,
            updateTabs,
        ],
    )

    useEffect(() => {
        let disposed = false
        const rpc = createChatUiRpc({
            host2Ui: {
                setStatus(message) {
                    setHostStatus(message)
                },
                async setTheme(mode) {
                    applyJbTheme(mode)
                },
                async settingsChanged(scope, projectRoot, revision) {
                    const change = toSettingsChanged(scope, projectRoot, revision)
                    const runtime = settingsRuntimeRef.current
                    if (!runtime || !change) return
                    try {
                        await runtime.notify(change.scope, change.projectRoot, change.revision)
                    } catch (settingsError) {
                        log.warn("settings refresh failed", settingsError)
                    }
                },
            },
            host2UiChat: {
                async addChatContexts(sessionId, incoming) {
                    appendContexts(
                        sessionId,
                        incoming.map((item) => ({
                            id: item.id,
                            kind: item.kind === "selection" ? "selection" : "file",
                            path: item.path,
                            text: item.text ?? undefined,
                            startLine: item.startLine ?? undefined,
                            endLine: item.endLine ?? undefined,
                        })),
                    )
                },
            },
        })

        if (!rpc) {
            updateOffline(true)
            setHostStatus("browser preview")
            setAgentStatus("unavailable")
            const demo = createDemoTab()
            updateTabs([demo])
            updateActiveId(demo.summary.sessionId)
        } else {
            hostRef.current = rpc.ui2Host
            hostChatRef.current = rpc.ui2HostChat
            peerRef.current = rpc.peer
            unbindConsoleRef.current = bindConsoleToHost(rpc.ui2Host)
            // Install the runtime before bootstrap awaits Host calls so an early
            // settingsChanged notification is queued and replayed by start().
            const runtime = new UiSettingsRuntime(rpc.ui2Host)
            settingsRuntimeRef.current = runtime
            setSettingsStore(runtime)
            void bootstrap(rpc.ui2Host, rpc.ui2HostChat, () => disposed)
        }

        return () => {
            disposed = true
            stopAgentRef.current?.()
            stopAgentRef.current = null
            unbindConsoleRef.current?.()
            unbindConsoleRef.current = null
            settingsRuntimeRef.current = null
            setSettingsStore(null)
            peerRef.current?.close()
            peerRef.current = null
            hostRef.current = null
            hostChatRef.current = null
            agentRef.current = null
            const permission = pendingPermissionRef.current
            if (permission) {
                permission.resolve({requestId: permission.request.requestId, decision: "cancelled"})
                updatePendingPermission(null)
            }
            const input = pendingInputRef.current
            if (input) {
                input.resolve({requestId: input.request.requestId, cancelled: true})
                updatePendingInput(null)
            }
        }
    }, [
        appendContexts,
        bootstrap,
        updateActiveId,
        updateOffline,
        updatePendingInput,
        updatePendingPermission,
        updateTabs,
    ])

    const activate = async (sessionId: string) => {
        updateActiveId(sessionId)
        updateTabs((current) =>
            current.map((tab) =>
                tab.summary.sessionId === sessionId
                    ? {...tab, summary: {...tab.summary, unread: false}}
                    : tab,
            ),
        )
        await persistWorkspace()
        if (agentRef.current && !offlineRef.current) {
            void agentRef.current.markChatSessionRead(sessionId).catch(() => {
            })
            await loadModels(sessionId)
        }
    }

    const newSession = async () => {
        setRecentOpen(false)
        if (offlineRef.current) {
            const id = `demo-${Date.now()}`
            const tab: ChatTab = {
                summary: {
                    sessionId: id,
                    title: t("chat:newSession"),
                    state: "idle",
                    unread: false,
                    updatedAt: Date.now(),
                    messageCount: 0,
                },
                messages: [],
            }
            updateTabs((current) => [...current, tab])
            updateActiveId(id)
            return
        }
        if (!agentRef.current) return
        try {
            const snapshot = await agentRef.current.createChatSession({
                projectRoot: projectRootRef.current,
            })
            updateTabs((current) => [...current, snapshot])
            await activate(snapshot.summary.sessionId)
        } catch (createError) {
            setError(errorText(createError))
        }
    }

    const closeSession = async (sessionId: string) => {
        const tab = tabsRef.current.find((item) => item.summary.sessionId === sessionId)
        if (!tab) return
        const running = ["running", "waiting_permission", "waiting_input"].includes(
            tab.summary.state,
        )
        if (running && !window.confirm(t("chat:closeRunning"))) return
        try {
            if (running && agentRef.current) await agentRef.current.abortChatTurn(sessionId)
            if (agentRef.current && !offlineRef.current) {
                await agentRef.current.releaseChatSession(sessionId)
            }
            let nextTabs = tabsRef.current.filter(
                (item) => item.summary.sessionId !== sessionId,
            )
            updateTabs(nextTabs)
            if (nextTabs.length === 0) {
                await newSession()
                nextTabs = tabsRef.current
            }
            if (activeIdRef.current === sessionId && nextTabs[0]) {
                await activate(nextTabs[0].summary.sessionId)
            }
            void persistWorkspace()
        } catch (closeError) {
            setError(errorText(closeError))
        }
    }

    const closeOtherSessions = async (sessionId: string) => {
        const others = tabsRef.current.filter((item) => item.summary.sessionId !== sessionId)
        if (others.length === 0) return
        const hasRunning = others.some((tab) =>
            ["running", "waiting_permission", "waiting_input"].includes(tab.summary.state),
        )
        if (hasRunning && !window.confirm(t("chat:closeOtherRunning"))) return
        try {
            for (const tab of others) {
                const running = ["running", "waiting_permission", "waiting_input"].includes(
                    tab.summary.state,
                )
                if (running && agentRef.current) {
                    await agentRef.current.abortChatTurn(tab.summary.sessionId)
                }
                if (agentRef.current && !offlineRef.current) {
                    await agentRef.current.releaseChatSession(tab.summary.sessionId)
                }
            }
            updateTabs(
                tabsRef.current.filter((item) => item.summary.sessionId === sessionId),
            )
            if (activeIdRef.current !== sessionId) {
                await activate(sessionId)
            }
            void persistWorkspace()
        } catch (closeError) {
            setError(errorText(closeError))
        }
    }

    const refreshRecent = async () => {
        const open = !recentOpen
        setRecentOpen(open)
        if (!open || !agentRef.current || offlineRef.current) return
        try {
            setRecent(
                await agentRef.current.listRecentChatSessions({
                    projectRoot: projectRootRef.current,
                }),
            )
        } catch (recentError) {
            setError(errorText(recentError))
        }
    }

    const closeRecent = useCallback(() => {
        setRecentOpen(false)
    }, [])

    const openRecent = async (session: RecentChatSession) => {
        setRecentOpen(false)
        const existing = tabsRef.current.find(
            (tab) => tab.summary.sessionId === session.sessionId,
        )
        if (existing) {
            await activate(existing.summary.sessionId)
            return
        }
        if (!agentRef.current) return
        try {
            const snapshot = await agentRef.current.openChatSession({
                projectRoot: projectRootRef.current,
                sessionId: session.sessionId,
                sessionFile: session.sessionFile,
            })
            updateTabs((current) => [...current, snapshot])
            await activate(snapshot.summary.sessionId)
        } catch (openError) {
            setError(errorText(openError))
        }
    }

    const sendMessage = async (sessionId: string, text: string) => {
        const trimmed = text.trim()
        const tab = tabsRef.current.find((item) => item.summary.sessionId === sessionId)
        if (!sessionId || !trimmed || !tab) return
        if (["running", "waiting_permission", "waiting_input", "queued"].includes(tab.summary.state)) {
            return
        }
        if (!offlineRef.current && !agentRef.current) return
        setDrafts((current) => ({...current, [sessionId]: ""}))
        if (offlineRef.current) {
            updateTabs((current) =>
                current.map((item) =>
                    item.summary.sessionId === sessionId
                        ? {
                            ...item,
                            messages: [
                                ...item.messages,
                                {
                                    id: `local-${Date.now()}`,
                                    role: "user",
                                    parts: [{kind: "text", text: trimmed}],
                                    createdAt: Date.now(),
                                    status: "complete",
                                },
                            ],
                        }
                        : item,
                ),
            )
            return
        }
        if (!agentRef.current) return
        setError(null)
        try {
            await agentRef.current.sendChatMessage({
                sessionId,
                text: trimmed,
                contexts: contextsRef.current[sessionId] ?? [],
                clientMessageId: crypto.randomUUID(),
            })
            updateContexts((current) => ({...current, [sessionId]: []}))
        } catch (sendError) {
            setDrafts((current) => ({...current, [sessionId]: text}))
            setError(errorText(sendError))
        }
    }

    const stopOrCancel = async (sessionId = activeIdRef.current) => {
        if (!agentRef.current || offlineRef.current || !sessionId) return
        const tab = tabsRef.current.find((item) => item.summary.sessionId === sessionId)
        try {
            if (tab?.summary.state === "queued") {
                await agentRef.current.cancelQueuedTurn(sessionId)
            } else {
                await agentRef.current.abortChatTurn(sessionId)
            }
        } catch (abortError) {
            setError(errorText(abortError))
        }
    }

    const chooseContextFiles = async () => {
        const sessionId = activeIdRef.current
        if (!hostChatRef.current || offlineRef.current || !sessionId) return
        try {
            const relativePaths = await hostChatRef.current.selectChatContextFiles()
            appendContexts(
                sessionId,
                relativePaths.map((relativePath) => ({
                    id: crypto.randomUUID(),
                    kind: "file",
                    path: relativePath,
                })),
            )
        } catch (chooseError) {
            setError(errorText(chooseError))
        }
    }

    const removeContext = (sessionId: string, contextId: string) => {
        updateContexts((current) => ({
            ...current,
            [sessionId]: (current[sessionId] ?? []).filter((item) => item.id !== contextId),
        }))
    }

    const setModel = async (modelId: string) => {
        if (!agentRef.current || offlineRef.current || !activeIdRef.current) return
        try {
            await agentRef.current.setChatModel(activeIdRef.current, modelId)
        } catch (modelError) {
            setError(errorText(modelError))
        }
    }

    const persistModelPreferences = (preferences: ModelPreferences) => {
        const runtime = settingsRuntimeRef.current
        if (!runtime || offlineRef.current) return
        void runtime.mutate(modelPreferenceMutations(preferences)).catch((preferencesError) => {
            log.warn("model preferences save failed", preferencesError)
            setError(errorText(preferencesError))
        })
    }

    const onChatModelChange = (spec: string, pinned: string[], recentModels: string[]) => {
        const preferences = {
            pinnedModelSpecs: [...pinned],
            recentModelSpecs: [...recentModels],
        }
        setModelPreferences(preferences)
        persistModelPreferences(preferences)
        if (spec && spec !== activeTab?.summary.modelId) void setModel(spec)
    }

    const setThinking = async (level: string) => {
        if (!agentRef.current || offlineRef.current || !activeIdRef.current) return
        try {
            await agentRef.current.setChatThinkingLevel(activeIdRef.current, level)
        } catch (thinkingError) {
            setError(errorText(thinkingError))
        }
    }

    const reorderTabs = (draggedId: string, targetId: string) => {
        if (!draggedId || draggedId === targetId) return
        updateTabs((current) => {
            const from = current.findIndex((tab) => tab.summary.sessionId === draggedId)
            const to = current.findIndex((tab) => tab.summary.sessionId === targetId)
            if (from < 0 || to < 0) return current
            const reordered = [...current]
            const [moved] = reordered.splice(from, 1)
            reordered.splice(to, 0, moved!)
            return reordered
        })
        void persistWorkspace()
    }

    const respondPermission = (decision: ToolPermissionDecision) => {
        const pending = pendingPermissionRef.current
        if (!pending) return
        updatePendingPermission(null)
        pending.resolve({requestId: pending.request.requestId, decision})
    }

    const respondInput = (cancelInput = false) => {
        const pending = pendingInputRef.current
        if (!pending) return
        updatePendingInput(null)
        pending.resolve({
            requestId: pending.request.requestId,
            text: cancelInput ? undefined : inputReply,
            cancelled: cancelInput,
        })
        setInputReply("")
    }

    const openLocation = useCallback((path: string, line?: number) => {
        if (!offlineRef.current) void hostChatRef.current?.openProjectFile(path, line ?? null)
    }, [])

    const showDiff = useCallback((path: string) => {
        if (!offlineRef.current) void hostChatRef.current?.showProjectDiff(path)
    }, [])

    const openExternalUrl = useCallback((url: string) => {
        if (!offlineRef.current) void hostRef.current?.openExternalUrl(url)
    }, [])

    const setDraft = (sessionId: string, value: string) => {
        setDrafts((current) => ({...current, [sessionId]: value}))
    }

    return {
        hostStatus,
        agentStatus,
        tabs,
        activeId,
        activeTab,
        recent,
        recentOpen,
        offline,
        error,
        activeDraft,
        activeContexts,
        activeModelOptions,
        modelPreferences,
        thinkingOptions,
        busy,
        queued,
        connected: agentStatus === "ready",
        pendingPermission,
        pendingInput,
        inputReply,
        actions: {
            activate,
            newSession,
            closeSession,
            closeOtherSessions,
            refreshRecent,
            closeRecent,
            openRecent,
            reorderTabs,
            setDraft,
            sendMessage,
            stopOrCancel,
            chooseContextFiles,
            removeContext,
            onChatModelChange,
            setThinking,
            respondPermission,
            respondInput,
            setInputReply,
            dismissError: () => setError(null),
            openSettings: () => void hostChatRef.current?.openIdeSettings(),
            openLocation,
            showDiff,
            openExternalUrl,
        },
    }
}
