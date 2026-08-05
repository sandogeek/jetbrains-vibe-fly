import { Search, Settings2, SlidersHorizontal } from "lucide-react"
import { i18n, useAppTranslation } from "../i18n"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { useLocation, useNavigate } from "react-router-dom"
import type {
  Host2UiService,
  IdeSettingsDto,
  LoginInputResponse,
  Ui2Host,
} from "../generated/rpc"
import { createUiRpc } from "../rpc/client"
import { bindConsoleToHost } from "../rpc/console"
import { applyJbTheme } from "../theme"
import { CommitMessagePage } from "./CommitMessagePage"
import { ProvidersPage } from "./ProvidersPage"
import { mergeProvidersSnapshot, type ProvidersSnapshot } from "./providerSnapshots"
import { PROVIDER_CONFIG_RPC_OPTIONS } from "./rpcOptions"
import { emptySettings, initialState, normalizeSettings, type SettingsState } from "./settingsStore"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
  useSidebar,
} from "../components/ui/sidebar"

type LoginHandlers = {
  onOpenUrl: (url: string, launchUrl: string | null) => void
  onProgress: (message: string) => void
  onRequestInput: (prompt: string, placeholder: string | null) => Promise<LoginInputResponse>
}

export function SettingsShell() {
  const { t } = useAppTranslation(["settings", "sidebar"])
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useState("")
  const [state, setState] = useState<SettingsState>(() => initialState())
  const [ui2Host, setUi2Host] = useState<Ui2Host | null>(null)
  const loginHandlers = useRef<LoginHandlers | null>(null)

  useEffect(() => {
    let cancelled = false
    let peerClose: (() => void) | undefined
    let unbindConsole: (() => void) | undefined
    const host2Ui: Host2UiService = {
      async setStatus(message) {
        if (!cancelled) setState((current) => ({ ...current, status: message }))
      },
      async loginOpenUrl(url, launchUrl) {
        loginHandlers.current?.onOpenUrl(url, launchUrl)
      },
      async loginProgress(message) {
        loginHandlers.current?.onProgress(message)
      },
      async requestLoginInput(prompt, placeholder) {
        if (!loginHandlers.current) return { text: "", cancelled: true }
        return loginHandlers.current.onRequestInput(prompt, placeholder)
      },
      async addChatContexts() {},
      async setTheme(mode) {
        applyJbTheme(mode)
      },
    }

    const rpc = createUiRpc(host2Ui)
    if (rpc) {
      setUi2Host(rpc.ui2Host)
      peerClose = () => rpc.peer.close()
      unbindConsole = bindConsoleToHost(rpc.ui2Host)
    }

    void (async () => {
      setState((current) => ({ ...current, busy: true, loadError: null }))
      let settings = emptySettings()
      let snapshot: ProvidersSnapshot | null = null
      let loadError: string | null = null
      const host = rpc?.ui2Host ?? null

      if (host) {
        try {
          settings = normalizeSettings(await host.getIdeSettings())
        } catch (error) {
          loadError = error instanceof Error ? error.message : String(error)
        }
        try {
          const refresh = await host.refreshProviders(PROVIDER_CONFIG_RPC_OPTIONS)
          if (refresh.ok) snapshot = mergeProvidersSnapshot(refresh.snapshot, state.catalog)
          else loadError = loadError ?? refresh.error ?? i18n.t("settings:refreshFailed")
        } catch (error) {
          loadError = loadError ?? (error instanceof Error ? error.message : String(error))
        }
      } else {
        loadError = i18n.t("settings:hostUnavailable")
      }

      if (!cancelled) setState((current) => ({ ...current, settings, snapshot, loadError, busy: false }))
    })()

    return () => {
      cancelled = true
      peerClose?.()
      unbindConsole?.()
      setUi2Host(null)
    }
  }, [])

  const saveSettings = async (settings: IdeSettingsDto) => {
    const host = ui2Host
    if (!host) return
    try {
      await host.saveIdeSettings(settings)
      const fresh = normalizeSettings(await host.getIdeSettings())
      setState((current) => ({ ...current, settings: fresh }))
    } catch (error) {
      setState((current) => ({ ...current, status: error instanceof Error ? error.message : String(error) }))
    }
  }

  const activePath = location.pathname
  const hasSearch = (label: string) => !search.trim() || label.toLowerCase().includes(search.trim().toLowerCase())
  const showingCommit = activePath.includes("/commit-message")

  return (
    <SidebarProvider className="h-full min-h-0 overflow-hidden">
      <Sidebar>
        <SidebarHeader>
          <div className="flex justify-end px-1"><SidebarTrigger label={t("settings:title")} /></div>
          <SidebarSearch value={search} placeholder={t("sidebar:search")} shortcut={t("sidebar:searchShortcut")} onInput={setSearch} />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {hasSearch(t("settings:providers")) && (
                  <SettingsNavItem label={t("settings:providers")} icon={<Settings2 />} active={activePath.includes("/settings/providers")} onSelect={() => navigate("/settings/providers")} />
                )}
                {hasSearch(t("settings:commitMessage")) && (
                  <SettingsNavItem label={t("settings:commitMessage")} icon={<SlidersHorizontal />} active={activePath.includes("/settings/commit-message")} onSelect={() => navigate("/settings/commit-message")} />
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          {state.status && <div className="truncate px-2 text-[11px] text-muted" title={state.status}>{state.status}</div>}
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="flex h-full min-h-0 flex-col overflow-hidden">
        {state.loadError && <div className="border-b border-border bg-surface px-4 py-2 text-xs text-muted">{state.loadError}</div>}
        {showingCommit ? (
          <CommitMessagePage
            settings={state.settings}
            snapshot={state.snapshot}
            catalog={state.catalog}
            busy={state.busy}
            onSettings={(settings) => setState((current) => ({ ...current, settings }))}
            onSave={saveSettings}
          />
        ) : (
          <ProvidersPage
            ui2Host={ui2Host}
            settings={state.settings}
            snapshot={state.snapshot}
            catalog={state.catalog}
            busy={state.busy}
            onSettings={(settings) => setState((current) => ({ ...current, settings }))}
            onSnapshot={(snapshot) => setState((current) => ({ ...current, snapshot }))}
            onBusy={(busy) => setState((current) => ({ ...current, busy }))}
            onStatus={(status) => setState((current) => ({ ...current, status }))}
            onSave={saveSettings}
            registerLoginHandlers={(handlers) => { loginHandlers.current = handlers }}
          />
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}

function SettingsNavItem({ label, icon, active, disabled, onSelect }: { label: string; icon: ReactNode; active?: boolean; disabled?: boolean; onSelect?: () => void }) {
  return <SidebarMenuItem><SidebarMenuButton title={label} active={active} disabled={disabled} onClick={onSelect}>{icon}</SidebarMenuButton></SidebarMenuItem>
}

function SidebarSearch({ value, placeholder, shortcut, onInput }: { value: string; placeholder: string; shortcut: string; onInput: (value: string) => void }) {
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
    return <button type="button" className="mx-auto mt-2 grid size-9 place-items-center rounded-md text-muted hover:bg-surface-raised hover:text-fg" title={placeholder} aria-label={placeholder} onClick={sidebar.toggle}><Search className="size-4" /></button>
  }
  return (
    <label className="relative mt-2 block">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input ref={inputRef} className="h-9 w-full rounded-md border border-border bg-surface/70 pl-8 pr-12 text-xs text-fg outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-ring" value={value} onChange={(event) => onInput(event.currentTarget.value)} placeholder={placeholder} aria-label={placeholder} />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] text-muted">{shortcut}</kbd>
    </label>
  )
}
