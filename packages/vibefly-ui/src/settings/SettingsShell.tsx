import {Languages, Search, Settings2, SlidersHorizontal} from "lucide-react"
import {type SettingMutation} from "@vibefly/uiagent-shared"
import {applyUiLocale, useAppTranslation} from "../i18n"
import {type ReactNode, useEffect, useRef, useState} from "react"

import {useLocation, useNavigate} from "react-router-dom"
import type {
    Host2UiService,
    Host2UiSettingsService,
    LoginInputResponse,
    Ui2Host,
} from "../generated/rpc"
import {createSettingsUiRpc} from "../rpc/client"
import {bindConsoleToHost} from "../rpc/console"
import {applyJbTheme} from "../theme"
import {CommitMessagePage} from "./CommitMessagePage"
import {GeneralPage} from "./GeneralPage"
import {ProvidersPage} from "./ProvidersPage"
import {emptySettings, initialState, type SettingsState} from "./settingsStore"
import {SettingsMutationQueue, type SettingsMutateOptions} from "./settingsMutationQueue"
import {releaseSettingsShellOwnership} from "./settingsShellOwnership"
import {UiSettingsRuntime, useUiSettingsView} from "./UiSettingsRuntime"
import {UiProviderSettingsClient} from "./UiProviderSettingsClient"
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
    const [settingsStore, setSettingsStore] = useState<UiSettingsRuntime | null>(null)
    const settingsView = useUiSettingsView(settingsStore)
    const settings = settingsView?.settings ?? emptySettings()
    const loadError = settingsView?.diagnostics ?? state.loadError
    const loginHandlers = useRef<LoginHandlers | null>(null)
    const settingsRuntime = useRef<UiSettingsRuntime | null>(null)
    const providerClient = useRef<UiProviderSettingsClient | null>(null)
    const mutationQueue = useRef<SettingsMutationQueue | null>(null)

    useEffect(() => {
        let cancelled = false
        // Effect-local ownership. Shared refs/state are only cleared when they still
        // point at these instances — required under StrictMode (setup → cleanup → setup)
        // because queue.close() finishes asynchronously after the next setup.
        // Effect 局部所有权。共享 ref/state 仅在仍指向这些实例时才清除——
        // StrictMode（setup → cleanup → setup）下必需，因为 queue.close() 在下次 setup 之后才异步结束。
        let runtime: UiSettingsRuntime | null = null
        let providers: UiProviderSettingsClient | null = null
        let ui2HostInstance: Ui2Host | null = null
        let peerClose: (() => void) | undefined
        let unbindConsole: (() => void) | undefined
        let unsubscribeProviderRefresh: (() => void) | undefined
        const queue = new SettingsMutationQueue(
            () => runtime,
            (error) => {
                if (!cancelled) {
                    setState((current) => ({
                        ...current,
                        status: error instanceof Error ? error.message : String(error),
                    }))
                }
            },
        )
        mutationQueue.current = queue
        const host2Ui: Host2UiService = {
            async setStatus(message) {
                if (!cancelled) setState((current) => ({...current, status: message}))
            },
            async setTheme(mode) {
                applyJbTheme(mode)
            },
            async settingsChanged(scope, projectRoot, revision) {
                try {
                    await runtime?.notify(scope, projectRoot, revision)
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
            ui2HostInstance = rpc.ui2Host
            setUi2Host(rpc.ui2Host)
            peerClose = () => rpc.peer.close()
            unbindConsole = bindConsoleToHost(rpc.ui2Host)
        }

        void (async () => {
            if (!cancelled) setState((current) => ({...current, busy: true, loadError: null}))
            let loadError: string | null = null
            const host = rpc?.ui2Host ?? null
            const settingsHost = rpc?.ui2HostSettings ?? null

            if (host && settingsHost) {
                const nextRuntime = new UiSettingsRuntime(host)
                const nextProviders = new UiProviderSettingsClient(settingsHost, nextRuntime, state.catalog)
                // Install before awaits so Host settingsChanged can reach this effect's runtime.
                // 在 await 之前安装，以便 Host 的 settingsChanged 能到达本 effect 的 runtime。
                runtime = nextRuntime
                providers = nextProviders
                if (!cancelled) {
                    settingsRuntime.current = nextRuntime
                    setSettingsStore(nextRuntime)
                    providerClient.current = nextProviders
                }
                const refreshProviders = async () => {
                    const refresh = await nextProviders.refresh()
                    if (!refresh.ok) throw new Error(refresh.error ?? "Provider refresh failed")
                }
                try {
                    const view = await nextRuntime.start(false)
                    if (cancelled) return
                    applyUiLocale(view.settings.ui.locale)
                    loadError = view.diagnostics
                    unsubscribeProviderRefresh = nextProviders.watch((snapshot) => {
                        if (!cancelled) setState((current) => ({...current, snapshot}))
                    })
                } catch (error) {
                    if (cancelled) return
                    loadError = error instanceof Error ? error.message : String(error)
                }
                try {
                    if (!cancelled) await refreshProviders()
                } catch (error) {
                    loadError = loadError ?? (error instanceof Error ? error.message : String(error))
                }
            } else {
                loadError = t("settings:hostUnavailable")
            }

            if (!cancelled) setState((current) => ({
                ...current,
                loadError: loadError ?? current.loadError,
                busy: false,
            }))
        })()

        return () => {
            cancelled = true
            // Sync teardown: safe under StrictMode because cleanup runs before the next setup.
            // 同步拆除：StrictMode 下安全，因为 cleanup 在下次 setup 之前执行。
            unsubscribeProviderRefresh?.()
            unsubscribeProviderRefresh = undefined
            unbindConsole?.()
            unbindConsole = undefined
            if (mutationQueue.current === queue) {
                mutationQueue.current = null
            }
            // Flush this effect's queue, then close only its peer and drop shared ownership
            // when identity still matches (do not wipe the remounted effect's runtime).
            // 冲刷本 effect 的队列，再仅关闭其 peer，并在身份仍匹配时放弃共享所有权
            // （不要抹掉已 remount 的 effect 的 runtime）。
            void queue.close().finally(() => {
                peerClose?.()
                releaseSettingsShellOwnership({
                    runtime,
                    providers,
                    ui2Host: ui2HostInstance,
                    settingsRuntime,
                    providerClient,
                    setSettingsStore,
                    setUi2Host,
                })
            })
        }
    }, [])

    useEffect(() => {
        if (!settingsView) return
        applyUiLocale(settingsView.settings.ui.locale)
        setState((current) => ({
            ...current,
            loadError: settingsView.diagnostics,
        }))
    }, [settingsView])

    const onMutate = (mutations: readonly SettingMutation[], options?: SettingsMutateOptions) => {
        mutationQueue.current?.enqueue(mutations, options)
    }

    const activePath = location.pathname
    const hasSearch = (label: string) => !search.trim() || label.toLowerCase().includes(search.trim().toLowerCase())
    const showingCommit = activePath.includes("/commit-message")
    const showingGeneral = activePath.includes("/general") || (!activePath.includes("/providers") && !showingCommit)

    return (
        <SidebarProvider className="h-full min-h-0 overflow-hidden">
            <Sidebar collapsible="icon">
                <SidebarHeader>
                    <div className="flex justify-end px-1">
                        <SidebarTrigger aria-label={t("settings:title")} title={t("settings:title")}/>
                    </div>
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
                        <div className="truncate px-2 text-[11px] text-muted group-data-[collapsible=icon]:hidden"
                             title={state.status}>{state.status}</div>}
                </SidebarFooter>
            </Sidebar>
            <SidebarInset className="flex h-full min-h-0 flex-col overflow-hidden">
                {loadError && <div
                    className="border-b border-border bg-surface px-4 py-2 text-xs text-muted">{loadError}</div>}
                {showingCommit ? (
                    <CommitMessagePage
                        settings={settings}
                        snapshot={state.snapshot}
                        catalog={state.catalog}
                        busy={state.busy}
                        onMutate={onMutate}
                    />
                ) : showingGeneral ? (
                    <GeneralPage
                        settings={settings}
                        busy={state.busy}
                        onMutate={onMutate}
                    />
                ) : (
                    <ProvidersPage
                        ui2Host={ui2Host}
                        providerClient={providerClient.current}
                        settings={settings}
                        snapshot={state.snapshot}
                        catalog={state.catalog}
                        busy={state.busy}
                        onBusy={(busy) => setState((current) => ({...current, busy}))}
                        onStatus={(status) => setState((current) => ({...current, status}))}
                        onMutate={onMutate}
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
    return (
        <SidebarMenuItem>
            <SidebarMenuButton isActive={active} disabled={disabled} tooltip={label} onClick={onSelect}>
                {icon}
                <span>{label}</span>
            </SidebarMenuButton>
        </SidebarMenuItem>
    )
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
        return (
            <button
                type="button"
                className="mx-auto grid size-8 place-items-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                title={placeholder}
                aria-label={placeholder}
                onClick={sidebar.toggleSidebar}
            >
                <Search className="size-4"/>
            </button>
        )
    }
    return (
        <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"/>
            <input
                ref={inputRef}
                className="h-8 w-full rounded-md border border-sidebar-border bg-background pl-8 pr-12 text-xs text-sidebar-foreground outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                value={value}
                onChange={(event) => onInput(event.currentTarget.value)}
                placeholder={placeholder}
                aria-label={placeholder}
            />
            <kbd
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-sidebar-border bg-sidebar-accent px-1.5 py-0.5 text-[10px] text-muted">{shortcut}</kbd>
        </label>
    )
}
