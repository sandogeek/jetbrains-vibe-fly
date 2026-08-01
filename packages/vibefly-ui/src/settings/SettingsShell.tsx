import { Navigate, Route, useLocation, useNavigate } from "@solidjs/router"
import {
  Search,
  Settings2,
  SlidersHorizontal,
} from "lucide-solid"
import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import type {
  Host2UiService,
  IdeSettingsDto,
  LoginInputResponse,
  Ui2Host,
} from "../generated/rpc"
import { useT } from "../i18n"
import { createUiRpc } from "../rpc/client"
import { bindConsoleToHost } from "../rpc/console"
import { applyJbTheme } from "../theme"
import { CommitMessagePage } from "./CommitMessagePage"
import { ProvidersPage } from "./ProvidersPage"
import {
  mergeProvidersSnapshot,
  type ProvidersSnapshot,
} from "./providerSnapshots"
import { PROVIDER_CONFIG_RPC_OPTIONS } from "./rpcOptions"
import { emptySettings, initialState, normalizeSettings, type SettingsState } from "./settingsStore"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
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

/**
 * Shared settings layout + data. Mounted as HashRouter root for /settings/*.
 */
export function SettingsShell(props: { children?: JSX.Element }) {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = createSignal("")
  const [state, setState] = createSignal<SettingsState>(initialState())
  const [ui2Host, setUi2Host] = createSignal<Ui2Host | null>(null)
  let peerClose: (() => void) | null = null
  let unbindConsole: (() => void) | null = null
  let loginHandlers: LoginHandlers | null = null

  onCleanup(() => {
    peerClose?.()
    peerClose = null
    unbindConsole?.()
    unbindConsole = null
  })

  onMount(() => {
    const host2Ui: Host2UiService = {
      async setStatus(message: string) {
        setState((s) => ({ ...s, status: message }))
      },
      async loginOpenUrl(url: string, launchUrl: string | null) {
        loginHandlers?.onOpenUrl(url, launchUrl)
      },
      async loginProgress(message: string) {
        loginHandlers?.onProgress(message)
      },
      async requestLoginInput(prompt: string, placeholder: string | null) {
        if (!loginHandlers) return { text: "", cancelled: true }
        return loginHandlers.onRequestInput(prompt, placeholder)
      },
      async addChatContexts() {},
      async setTheme(mode: string) {
        applyJbTheme(mode)
      },
    }

    const rpc = createUiRpc(host2Ui)
    if (rpc) {
      setUi2Host(rpc.ui2Host)
      peerClose = () => rpc.peer.close()
      unbindConsole = bindConsoleToHost(rpc.ui2Host)
    }

    void bootstrap(rpc?.ui2Host ?? null)
  })

  const bootstrap = async (host: Ui2Host | null) => {
    setState((s) => ({ ...s, busy: true, loadError: null }))
    let settings = emptySettings()
    let snapshot: ProvidersSnapshot | null = null
    let loadError: string | null = null

    if (host) {
      try {
        settings = normalizeSettings(await host.getIdeSettings())
      } catch (e) {
        loadError = e instanceof Error ? e.message : String(e)
      }
      try {
        const refresh = await host.refreshProviders(PROVIDER_CONFIG_RPC_OPTIONS)
        if (refresh.ok) {
          snapshot = mergeProvidersSnapshot(refresh.snapshot, state().catalog)
        } else {
          loadError = loadError ?? refresh.error ?? t("settings.refreshFailed")
        }
      } catch (e) {
        loadError = loadError ?? (e instanceof Error ? e.message : String(e))
      }
    } else {
      loadError = t("settings.hostUnavailable")
    }

    setState((s) => ({
      ...s,
      settings,
      snapshot,
      loadError,
      busy: false,
    }))
  }

  const saveSettings = async (settings: IdeSettingsDto) => {
    const host = ui2Host()
    if (!host) return
    try {
      await host.saveIdeSettings(settings)
      const fresh = normalizeSettings(await host.getIdeSettings())
      setState((s) => ({ ...s, settings: fresh }))
    } catch (e) {
      setState((s) => ({
        ...s,
        status: e instanceof Error ? e.message : String(e),
      }))
    }
  }

  const registerLoginHandlers = (handlers: LoginHandlers | null) => {
    loginHandlers = handlers
  }

  const activePath = () => location.pathname
  const hasSearch = (label: string) =>
    !search().trim() || label.toLowerCase().includes(search().trim().toLowerCase())

  return (
    <SidebarProvider class="h-full min-h-0 overflow-hidden">
      <Sidebar>
        <SidebarHeader>
          <div class="flex justify-end px-1">
            <SidebarTrigger label={t("settings.title")} />
          </div>
          <SidebarSearch
            value={search()}
            placeholder={t("sidebar.search")}
            shortcut={t("sidebar.searchShortcut")}
            onInput={setSearch}
          />
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <Show when={hasSearch(t("settings.providers"))}>
                  <SettingsNavItem
                    label={t("settings.providers")}
                    icon={<Settings2 />}
                    active={activePath().includes("/settings/providers")}
                    onSelect={() => navigate("/settings/providers")}
                  />
                </Show>
                <Show when={hasSearch(t("settings.commitMessage"))}>
                  <SettingsNavItem
                    label={t("settings.commitMessage")}
                    icon={<SlidersHorizontal />}
                    active={activePath().includes("/settings/commit-message")}
                    onSelect={() => navigate("/settings/commit-message")}
                  />
                </Show>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <Show when={state().status}>
            {(msg) => <div class="truncate px-2 text-[11px] text-muted" title={msg()}>{msg()}</div>}
          </Show>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset class="flex h-full min-h-0 flex-col overflow-hidden">
        <Show when={state().loadError}>
          {(e) => (
            <div class="border-b border-border bg-surface px-4 py-2 text-xs text-muted">{e()}</div>
          )}
        </Show>
        {/* Route outlet: children from nested Route components */}
        <Show
          when={useLocation().pathname.includes("/commit-message")}
          fallback={
            <ProvidersPage
              ui2Host={ui2Host()}
              settings={state().settings}
              snapshot={state().snapshot}
              catalog={state().catalog}
              busy={state().busy}
              onSettings={(settings) => setState((s) => ({ ...s, settings }))}
              onSnapshot={(snapshot) => setState((s) => ({ ...s, snapshot }))}
              onBusy={(busy) => setState((s) => ({ ...s, busy }))}
              onStatus={(status) => setState((s) => ({ ...s, status }))}
              onSave={saveSettings}
              registerLoginHandlers={registerLoginHandlers}
            />
          }
        >
          <CommitMessagePage
            settings={state().settings}
            snapshot={state().snapshot}
            catalog={state().catalog}
            busy={state().busy}
            onSettings={(settings) => setState((s) => ({ ...s, settings }))}
            onSave={saveSettings}
          />
        </Show>
        {props.children}
      </SidebarInset>
    </SidebarProvider>
  )
}

function SettingsNavItem(props: {
  label: string
  icon: JSX.Element
  active?: boolean
  disabled?: boolean
  hidden?: boolean
  onSelect?: () => void
}) {
  return (
    <Show when={!props.hidden}>
      <SidebarMenuItem>
        <SidebarMenuButton
          title={props.label}
          active={props.active}
          disabled={props.disabled}
          onClick={() => props.onSelect?.()}
        >
          {props.icon}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </Show>
  )
}

function SidebarSearch(props: {
  value: string
  placeholder: string
  shortcut: string
  onInput: (value: string) => void
}) {
  const sidebar = useSidebar()
  let inputElement: HTMLInputElement | undefined

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault()
        sidebar.setOpen(true)
        requestAnimationFrame(() => inputElement?.focus())
      }
    }
    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown))
  })

  return (
    <Show
      when={sidebar.open()}
      fallback={
        <button
          type="button"
          class="mx-auto mt-2 grid size-9 place-items-center rounded-md text-muted hover:bg-surface-raised hover:text-fg"
          title={props.placeholder}
          aria-label={props.placeholder}
          onClick={sidebar.toggle}
        >
          <Search class="size-4" />
        </button>
      }
    >
      <label class="relative mt-2 block">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          ref={inputElement}
          class="h-9 w-full rounded-md border border-border bg-surface/70 pl-8 pr-12 text-xs text-fg outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-ring"
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          placeholder={props.placeholder}
          aria-label={props.placeholder}
        />
        <kbd class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] text-muted">
          {props.shortcut}
        </kbd>
      </label>
    </Show>
  )
}

export { Route }
