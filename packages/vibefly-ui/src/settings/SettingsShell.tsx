import { A, Navigate, Route, useLocation } from "@solidjs/router"
import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import type {
  Host2UiService,
  IdeSettingsDto,
  LoginInputResponse,
  ProvidersSnapshot,
  Ui2Host,
} from "../generated/rpc"
import { createUiRpc } from "../rpc/client"
import { bindConsoleToHost } from "../rpc/console"
import { loadBundledCatalog } from "./catalog"
import { CommitMessagePage } from "./CommitMessagePage"
import { ProvidersPage } from "./ProvidersPage"
import { emptySettings, initialState, normalizeSettings, type SettingsState } from "./settingsStore"

type LoginHandlers = {
  onOpenUrl: (url: string, launchUrl: string | null) => void
  onProgress: (message: string) => void
  onRequestInput: (prompt: string, placeholder: string | null) => Promise<LoginInputResponse>
}

/**
 * Shared settings layout + data. Mounted as HashRouter root for /settings/*.
 */
export function SettingsShell(props: { children?: JSX.Element }) {
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
    const catalogResult = await loadBundledCatalog()
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
        const refresh = await host.refreshProviders("")
        if (refresh.ok) {
          snapshot = refresh.snapshot ?? null
        } else {
          loadError = loadError ?? refresh.error ?? "Refresh failed"
        }
      } catch (e) {
        loadError = loadError ?? (e instanceof Error ? e.message : String(e))
      }
    } else {
      loadError = "Host RPC unavailable (open inside IDE JCEF)"
    }

    setState((s) => ({
      ...s,
      catalog: catalogResult.catalog,
      catalogError: catalogResult.error,
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

  return (
    <div class="flex h-full min-h-0 w-full bg-bg text-fg">
      <aside class="flex w-52 shrink-0 flex-col border-r border-border bg-surface/30">
        <div class="border-b border-border px-4 py-3">
          <div class="text-sm font-semibold tracking-wide text-fg">Vibe Fly</div>
          <div class="text-[11px] text-muted">Settings</div>
        </div>
        <nav class="flex flex-col gap-0.5 p-2">
          <NavLink href="/settings/providers" label="Providers" />
          <NavLink href="/settings/commit-message" label="Commit Message" />
        </nav>
        <Show when={state().status}>
          {(msg) => (
            <div class="mt-auto border-t border-border p-2 text-[11px] text-muted">{msg()}</div>
          )}
        </Show>
      </aside>
      <main class="min-w-0 flex-1">
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
              catalogError={state().catalogError}
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
      </main>
    </div>
  )
}

function NavLink(props: { href: string; label: string }) {
  const location = useLocation()
  const active = () =>
    location.pathname === props.href || location.pathname.startsWith(`${props.href}/`)
  return (
    <A
      href={props.href}
      class="rounded px-3 py-2 text-sm no-underline"
      classList={{
        "bg-surface text-fg font-medium": active(),
        "text-muted hover:bg-surface/60 hover:text-fg": !active(),
      }}
    >
      {props.label}
    </A>
  )
}

/** Nested route components kept for HashRouter tree completeness. */
export function SettingsProvidersRoute() {
  return null
}

export function SettingsCommitRoute() {
  return null
}

export function SettingsIndexRedirect() {
  return <Navigate href="/settings/providers" />
}

export { Route }
