import {Languages, Search, Settings2, SlidersHorizontal} from "lucide-react"
import {applyUiLocale, i18n, useAppTranslation} from "../i18n"
import {type ReactNode, useEffect, useRef, useState} from "react"

import {useLocation, useNavigate} from "react-router-dom"
import type {
    Host2UiService,
    Host2UiSettingsService,
    LoginInputResponse,
    Ui2Host,
    Ui2HostSettings,
} from "../generated/rpc"
import {createSettingsUiRpc} from "../rpc/client"
import {bindConsoleToHost} from "../rpc/console"
import {applyJbTheme} from "../theme"
import {CommitMessagePage} from "./CommitMessagePage"
import {GeneralPage} from "./GeneralPage"
import {ProvidersPage} from "./ProvidersPage"
import {mergeProvidersSnapshot, type ProvidersSnapshot} from "./providerSnapshots"
import {PROVIDER_CONFIG_RPC_OPTIONS} from "./rpcOptions"
import {emptySettings, type IdeSettings, initialState, type SettingsState} from "./settingsStore"
import {
    applySettingsFormPatch,
    createUiSettingsManager,
    diffSettingsForms,
    formFromEffective,
    isEmptySettingsFormPatch,
    mergeSettingsFormPatches,
    prepareSettingsFormPatchSave,
    settingsChanged as toSettingsChanged,
    type SettingsFormPatch,
    subtractSettingsFormPatch,
} from "./hostSettings"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarTrigger,
    useSidebar,
} from "../components/ui/sidebar"

type LoginHandlers = {
    onOpenUrl: (url: string, launchUrl: string | null) => void
    onProgress: (message: string) => void
    onRequestInput: (prompt: string, placeholder: string | null) => Promise<LoginInputResponse>
}

export function SettingsShell() {
    const {t} = useAppTranslation(["settings", "sidebar"])
    const navigate = useNavigate()
    const location = useLocation()
    const [search, setSearch] = useState("")
    const [state, setState] = useState<SettingsState>(() => initialState())
    const [ui2Host, setUi2Host] = useState<Ui2Host | null>(null)
    const [ui2HostSettings, setUi2HostSettings] = useState<Ui2HostSettings | null>(null)
    const loginHandlers = useRef<LoginHandlers | null>(null)
    const settingsManager = useRef<ReturnType<typeof createUiSettingsManager> | null>(null)
    const settingsSaveTail = useRef<Promise<void>>(Promise.resolve())
    const pendingFormPatch = useRef<SettingsFormPatch>({})
    const displayedSettings = useRef<IdeSettings>(state.settings)

    useEffect(() => {
        let cancelled = false
        let settingsInitialized = false
        let peerClose: (() => void) | undefined
        let unbindConsole: (() => void) | undefined
        let unsubscribeSettings: (() => void) | undefined
        const pendingSettingsChanges = new Map<
            "application" | "project",
            NonNullable<ReturnType<typeof toSettingsChanged>>
        >()
        const host2Ui: Host2UiService = {
            async setStatus(message) {
                if (!cancelled) setState((current) => ({...current, status: message}))
            },
            async setTheme(mode) {
                applyJbTheme(mode)
            },
            async settingsChanged(scope, projectRoot, revision) {
                const change = toSettingsChanged(scope, projectRoot, revision)
                const manager = settingsManager.current
                if (!change || !manager) return
                if (!settingsInitialized) {
                    pendingSettingsChanges.set(change.scope, change)
                    return
                }
                try {
                    await manager.handleSettingsChanged(change)
                } catch (error) {
                    if (!cancelled) {
                        setState((current) => ({
                            ...current,
                            loadError: error instanceof Error ? error.message : String(error),
                        }))
                    }
                }
            },
        }
        const host2UiSettings: Host2UiSettingsService = {
            async loginOpenUrl(url, launchUrl) {
                loginHandlers.current?.onOpenUrl(url, launchUrl)
            },
            async loginProgress(message) {
                loginHandlers.current?.onProgress(message)
            },
            async requestLoginInput(prompt, placeholder) {
                if (!loginHandlers.current) return {text: "", cancelled: true}
                return loginHandlers.current.onRequestInput(prompt, placeholder)
            },
        }

        const rpc = createSettingsUiRpc({host2Ui, host2UiSettings})
        if (rpc) {
            setUi2Host(rpc.ui2Host)
            setUi2HostSettings(rpc.ui2HostSettings)
            peerClose = () => rpc.peer.close()
            unbindConsole = bindConsoleToHost(rpc.ui2Host)
        }

        void (async () => {
            setState((current) => ({...current, busy: true, loadError: null}))
            let settings = emptySettings()
            let snapshot: ProvidersSnapshot | null = null
            let loadError: string | null = null
            const host = rpc?.ui2Host ?? null
            const settingsHost = rpc?.ui2HostSettings ?? null

            if (host && settingsHost) {
                const manager = createUiSettingsManager(host)
                settingsManager.current = manager
                const refreshProviders = async () => {
                    const refresh = await settingsHost.refreshProviders(PROVIDER_CONFIG_RPC_OPTIONS)
                    if (!refresh.ok) throw new Error(refresh.error ?? i18n.t("settings:refreshFailed"))
                    let currentRevision = true
                    if (refresh.revision) {
                        const change = toSettingsChanged("application", null, refresh.revision)
                        if (change) {
                            await manager.handleSettingsChanged(change)
                            currentRevision = manager.getSnapshot("application")?.revision === refresh.revision
                        }
                    }
                    if (!currentRevision) return
                    const safeSnapshot = mergeProvidersSnapshot(refresh.snapshot, state.catalog)
                    if (!cancelled) setState((current) => ({...current, snapshot: safeSnapshot}))
                }
                unsubscribeSettings = manager.subscribe((change) => {
                    if (cancelled) return
                    const next = applySettingsFormPatch(
                        formFromEffective(change.effective),
                        pendingFormPatch.current,
                    )
                    displayedSettings.current = next
                    applyUiLocale(next.ui.locale)
                    const diagnostics = change.effective.diagnostics
                        .map((item) => `${item.file}: ${item.message}`)
                        .join("; ") || null
                    setState((current) => ({...current, settings: next, loadError: diagnostics}))
                    if (change.scope === "application") {
                        void refreshProviders().catch((error) => {
                            if (!cancelled) setState((current) => ({
                                ...current,
                                loadError: current.loadError ?? (error instanceof Error ? error.message : String(error)),
                            }))
                        })
                    }
                })
                try {
                    const initialEffective = await manager.initialize(false)
                    while (pendingSettingsChanges.size > 0) {
                        const changes = [...pendingSettingsChanges.values()]
                        pendingSettingsChanges.clear()
                        for (const change of changes) {
                            await manager.handleSettingsChanged(change)
                        }
                    }
                    settingsInitialized = true
                    const effective = manager.getEffectiveSettings() ?? initialEffective
                    settings = formFromEffective(effective)
                    loadError = effective.diagnostics
                        .map((item) => `${item.file}: ${item.message}`)
                        .join("; ") || null
                    applyUiLocale(settings.ui.locale)
                } catch (error) {
                    loadError = error instanceof Error ? error.message : String(error)
                }
                try {
                    const refresh = await settingsHost.refreshProviders(PROVIDER_CONFIG_RPC_OPTIONS)
                    if (refresh.ok) {
                        let currentRevision = true
                        if (refresh.revision) {
                            const change = toSettingsChanged("application", null, refresh.revision)
                            if (change) {
                                await manager.handleSettingsChanged(change)
                                currentRevision = manager.getSnapshot("application")?.revision === refresh.revision
                            }
                        }
                        if (currentRevision) {
                            snapshot = mergeProvidersSnapshot(refresh.snapshot, state.catalog)
                        }
                    }
                    else loadError = loadError ?? refresh.error ?? i18n.t("settings:refreshFailed")
                } catch (error) {
                    loadError = loadError ?? (error instanceof Error ? error.message : String(error))
                }
            } else {
                loadError = i18n.t("settings:hostUnavailable")
            }

            const effective = settingsManager.current?.getEffectiveSettings()
            if (effective) {
                settings = applySettingsFormPatch(
                    formFromEffective(effective),
                    pendingFormPatch.current,
                )
                loadError = effective.diagnostics
                    .map((item) => `${item.file}: ${item.message}`)
                    .join("; ") || null
            }
            displayedSettings.current = settings
            if (!cancelled) setState((current) => ({
                ...current,
                settings,
                snapshot: snapshot ?? current.snapshot,
                loadError: loadError ?? current.loadError,
                busy: false,
            }))
        })()

        return () => {
            cancelled = true
            peerClose?.()
            unbindConsole?.()
            unsubscribeSettings?.()
            settingsManager.current = null
            pendingFormPatch.current = {}
            setUi2Host(null)
            setUi2HostSettings(null)
        }
    }, [])

    const syncDisplayedSettings = () => {
        const effective = settingsManager.current?.getEffectiveSettings()
        if (!effective) return
        const next = applySettingsFormPatch(
            formFromEffective(effective),
            pendingFormPatch.current,
        )
        displayedSettings.current = next
        applyUiLocale(next.ui.locale)
        setState((current) => ({...current, settings: next}))
    }

    const updateDraftSettings = (next: IdeSettings) => {
        pendingFormPatch.current = mergeSettingsFormPatches(
            pendingFormPatch.current,
            diffSettingsForms(displayedSettings.current, next),
        )
        displayedSettings.current = next
        setState((current) => ({...current, settings: next}))
    }

    const persistSettings = async (patch: SettingsFormPatch) => {
        const host = ui2Host
        const manager = settingsManager.current
        if (!host || !manager) return
        for (let attempt = 0; attempt < 4; attempt += 1) {
            try {
                const prepared = prepareSettingsFormPatchSave(manager, patch)
                const result = await host.saveSettings({
                    scope: "application",
                    ...prepared,
                })
                if (result.revision) {
                    const change = toSettingsChanged("application", null, result.revision)
                    if (change) await manager.handleSettingsChanged(change)
                }
                if (result.ok) {
                    pendingFormPatch.current = subtractSettingsFormPatch(
                        pendingFormPatch.current,
                        patch,
                    )
                    syncDisplayedSettings()
                    return
                }
                if (result.conflict) continue
                setState((current) => ({
                    ...current,
                    status: result.error ?? t("settings:saveFailed"),
                }))
                return
            } catch (error) {
                setState((current) => ({...current, status: error instanceof Error ? error.message : String(error)}))
                return
            }
        }
        setState((current) => ({...current, status: t("settings:changedExternally")}))
    }

    const saveSettings = (patch: SettingsFormPatch): Promise<void> => {
        pendingFormPatch.current = mergeSettingsFormPatches(pendingFormPatch.current, patch)
        const operation = settingsSaveTail.current.then(async () => {
            const pending = mergeSettingsFormPatches({}, pendingFormPatch.current)
            if (!isEmptySettingsFormPatch(pending)) await persistSettings(pending)
        })
        settingsSaveTail.current = operation.catch(() => {
        })
        return operation
    }

    const activePath = location.pathname
    const hasSearch = (label: string) => !search.trim() || label.toLowerCase().includes(search.trim().toLowerCase())
    const showingCommit = activePath.includes("/commit-message")
    const showingGeneral = activePath.includes("/general") || (!activePath.includes("/providers") && !showingCommit)

    return (
        <SidebarProvider className="h-full min-h-0 overflow-hidden">
            <Sidebar>
                <SidebarHeader>
                    <div className="flex justify-end px-1"><SidebarTrigger label={t("settings:title")}/></div>
                    <SidebarSearch value={search} placeholder={t("sidebar:search")}
                                   shortcut={t("sidebar:searchShortcut")} onInput={setSearch}/>
                </SidebarHeader>
                <SidebarContent>
                    <SidebarGroup>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                {hasSearch(t("settings:general")) && (
                                    <SettingsNavItem label={t("settings:general")} icon={<Languages/>}
                                                     active={showingGeneral}
                                                     onSelect={() => navigate("/settings/general")}/>
                                )}
                                {hasSearch(t("settings:providers")) && (
                                    <SettingsNavItem label={t("settings:providers")} icon={<Settings2/>}
                                                     active={activePath.includes("/settings/providers")}
                                                     onSelect={() => navigate("/settings/providers")}/>
                                )}
                                {hasSearch(t("settings:commitMessage")) && (
                                    <SettingsNavItem label={t("settings:commitMessage")} icon={<SlidersHorizontal/>}
                                                     active={activePath.includes("/settings/commit-message")}
                                                     onSelect={() => navigate("/settings/commit-message")}/>
                                )}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>
                <SidebarFooter>
                    {state.status &&
                        <div className="truncate px-2 text-[11px] text-muted" title={state.status}>{state.status}</div>}
                </SidebarFooter>
            </Sidebar>
            <SidebarInset className="flex h-full min-h-0 flex-col overflow-hidden">
                {state.loadError && <div
                    className="border-b border-border bg-surface px-4 py-2 text-xs text-muted">{state.loadError}</div>}
                {showingCommit ? (
                    <CommitMessagePage
                        settings={state.settings}
                        snapshot={state.snapshot}
                        catalog={state.catalog}
                        busy={state.busy}
                        onSettings={updateDraftSettings}
                        onSave={saveSettings}
                    />
                ) : showingGeneral ? (
                    <GeneralPage
                        settings={state.settings}
                        busy={state.busy}
                        onSettings={updateDraftSettings}
                        onSave={saveSettings}
                    />
                ) : (
                    <ProvidersPage
                        ui2Host={ui2Host}
                        ui2HostSettings={ui2HostSettings}
                        settings={state.settings}
                        snapshot={state.snapshot}
                        applicationRevision={settingsManager.current?.getSnapshot("application")?.revision ?? ""}
                        catalog={state.catalog}
                        busy={state.busy}
                        onSettings={updateDraftSettings}
                        onSnapshot={(snapshot) => setState((current) => ({...current, snapshot}))}
                        onBusy={(busy) => setState((current) => ({...current, busy}))}
                        onStatus={(status) => setState((current) => ({...current, status}))}
                        onRevision={async (revision) => {
                            const manager = settingsManager.current
                            const change = toSettingsChanged("application", null, revision)
                            if (!manager || !change) return false
                            await manager.handleSettingsChanged(change)
                            return manager.getSnapshot("application")?.revision === revision
                        }}
                        onSave={saveSettings}
                        registerLoginHandlers={(handlers) => {
                            loginHandlers.current = handlers
                        }}
                    />
                )}
            </SidebarInset>
        </SidebarProvider>
    )
}

function SettingsNavItem({label, icon, active, disabled, onSelect}: {
    label: string;
    icon: ReactNode;
    active?: boolean;
    disabled?: boolean;
    onSelect?: () => void
}) {
    return <SidebarMenuItem><SidebarMenuButton title={label} active={active} disabled={disabled}
                                               onClick={onSelect}>{icon}</SidebarMenuButton></SidebarMenuItem>
}

function SidebarSearch({value, placeholder, shortcut, onInput}: {
    value: string;
    placeholder: string;
    shortcut: string;
    onInput: (value: string) => void
}) {
    const sidebar = useSidebar()
    const inputRef = useRef<HTMLInputElement>(null)
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
                event.preventDefault()
                sidebar.setOpen(true)
                requestAnimationFrame(() => inputRef.current?.focus())
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [sidebar])

    if (!sidebar.open) {
        return <button type="button"
                       className="mx-auto mt-2 grid size-9 place-items-center rounded-md text-muted hover:bg-surface-raised hover:text-fg"
                       title={placeholder} aria-label={placeholder} onClick={sidebar.toggle}><Search
            className="size-4"/></button>
    }
    return (
        <label className="relative mt-2 block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"/>
            <input ref={inputRef}
                   className="h-9 w-full rounded-md border border-border bg-surface/70 pl-8 pr-12 text-xs text-fg outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-ring"
                   value={value} onChange={(event) => onInput(event.currentTarget.value)} placeholder={placeholder}
                   aria-label={placeholder}/>
            <kbd
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] text-muted">{shortcut}</kbd>
        </label>
    )
}
