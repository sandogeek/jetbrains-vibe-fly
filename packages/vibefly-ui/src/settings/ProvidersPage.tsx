import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type {
  CredentialAction,
  IdeSettingsDto,
  ProviderPatch,
  ProviderSnapshot,
  ProvidersSnapshot,
  Ui2Host,
} from "../generated/rpc"
import { useT } from "../i18n"
import type { BundledCatalog } from "./catalog"
import { catalogProviderIds } from "./catalog"
import {
  ConnectDialog,
  CustomProviderDialog,
  LoginOverlay,
  parseModelsText,
  providerUiLabels,
  type ConnectResult,
  type CustomResult,
  type LoginOverlayState,
} from "./dialogs"
import { ModelPicker } from "./ModelPicker"
import {
  badgeLabel,
  classifyProviders,
  filterBuiltInProviders,
  modelSpec,
  parseModelSpec,
  primaryBadge,
} from "./providerLogic"
import { description, displayName } from "./providerLabels"
import { withModelPreferences, withProviders } from "./settingsStore"

export type ProvidersPageProps = {
  ui2Host: Ui2Host | null
  settings: IdeSettingsDto
  snapshot: ProvidersSnapshot | null
  catalog: BundledCatalog
  catalogError: string | null
  busy: boolean
  onSettings: (next: IdeSettingsDto) => void
  onSnapshot: (snap: ProvidersSnapshot | null) => void
  onBusy: (busy: boolean) => void
  onStatus: (msg: string | null) => void
  onSave: (settings: IdeSettingsDto) => Promise<void>
  registerLoginHandlers?: (
    handlers: {
      onOpenUrl: (url: string, launchUrl: string | null) => void
      onProgress: (message: string) => void
      onRequestInput: (
        prompt: string,
        placeholder: string | null,
      ) => Promise<{ text?: string; cancelled?: boolean }>
    } | null,
  ) => void
}

type DialogState =
  | { kind: "none" }
  | { kind: "connect"; snap: ProviderSnapshot; edit: boolean }
  | { kind: "custom"; existing: ProviderSnapshot | null }
  | { kind: "login"; state: LoginOverlayState }

export function ProvidersPage(props: ProvidersPageProps) {
  const t = useT()
  const [search, setSearch] = createSignal("")
  const [dialog, setDialog] = createSignal<DialogState>({ kind: "none" })
  let agentDirTimer: ReturnType<typeof setTimeout> | undefined

  onMount(() => {
    props.registerLoginHandlers?.({
      onOpenUrl: (url, launchUrl) => {
        setDialog((prev) => {
          if (prev.kind !== "login") return prev
          return {
            kind: "login",
            state: {
              ...prev.state,
              url,
              launchUrl,
              progress: t("providers.waitingAuth"),
            },
          }
        })
      },
      onProgress: (message) => {
        setDialog((prev) => {
          if (prev.kind !== "login") return prev
          return { kind: "login", state: { ...prev.state, progress: message } }
        })
      },
      onRequestInput: (prompt, placeholder) => {
        const { promise, resolve } = Promise.withResolvers<{
          text?: string
          cancelled?: boolean
        }>()
        setDialog((prev) => {
          if (prev.kind !== "login") {
            resolve({ text: "", cancelled: true })
            return prev
          }
          return {
            kind: "login",
            state: {
              ...prev.state,
              inputPrompt: prompt,
              inputPlaceholder: placeholder,
              resolveInput: resolve,
            },
          }
        })
        return promise
      },
    })
  })

  onCleanup(() => {
    props.registerLoginHandlers?.(null)
    clearTimeout(agentDirTimer)
  })

  const providers = createMemo(() => props.snapshot?.providers ?? [])
  const classified = createMemo(() => classifyProviders(providers()))
  const builtIn = createMemo(() => filterBuiltInProviders(classified().popular, search()))

  const defaultSpec = () =>
    modelSpec(
      props.settings.providers?.defaultProvider ?? "",
      props.settings.providers?.defaultModel ?? "",
    )

  const scheduleSave = (next: IdeSettingsDto) => {
    props.onSettings(next)
    void props.onSave(next)
  }

  const onAgentDirInput = (value: string) => {
    const next = withProviders(props.settings, { agentDir: value })
    props.onSettings(next)
    clearTimeout(agentDirTimer)
    agentDirTimer = setTimeout(() => {
      void props.onSave(next)
    }, 300)
  }

  const onDefaultModel = (spec: string, pinned: string[], recent: string[]) => {
    const { provider, model } = parseModelSpec(spec)
    let next = withProviders(props.settings, {
      defaultProvider: provider,
      defaultModel: model,
    })
    next = withModelPreferences(next, {
      pinnedModelSpecs: pinned,
      recentModelSpecs: recent,
    })
    scheduleSave(next)
  }

  const reload = async () => {
    if (!props.ui2Host) {
      props.onStatus(t("settings.hostUnavailable"))
      return
    }
    props.onBusy(true)
    props.onStatus(null)
    try {
      const agentDir = props.settings.providers?.agentDir ?? ""
      const result = await props.ui2Host.refreshProviders(agentDir)
      if (!result.ok) {
        props.onStatus(result.error ?? t("settings.refreshFailed"))
        return
      }
      props.onSnapshot(result.snapshot ?? null)
    } catch (e) {
      props.onStatus(e instanceof Error ? e.message : String(e))
    } finally {
      props.onBusy(false)
    }
  }

  const applyPatch = async (
    providersPatch: ProviderPatch[],
    credentials: CredentialAction[] = [],
  ) => {
    if (!props.ui2Host) {
      props.onStatus(t("settings.hostUnavailableShort"))
      return
    }
    props.onBusy(true)
    props.onStatus(null)
    try {
      const result = await props.ui2Host.applyProvidersPatch({
        agentDir: props.settings.providers?.agentDir ?? "",
        providers: providersPatch,
        credentials,
      })
      if (!result.ok) {
        props.onStatus(result.error ?? t("providers.saveFailed"))
        return
      }
      if (result.snapshot) props.onSnapshot(result.snapshot)
    } catch (e) {
      props.onStatus(e instanceof Error ? e.message : String(e))
    } finally {
      props.onBusy(false)
    }
  }

  const runLogin = async (snap: ProviderSnapshot) => {
    if (!props.ui2Host) return
    const loginId = snap.loginProviderId?.trim() || snap.id
    const name = displayName(snap.id)
    setDialog({
      kind: "login",
      state: {
        providerName: name,
        progress: t("providers.startingLogin", { name }),
        url: null,
        launchUrl: null,
        inputPrompt: null,
        inputPlaceholder: null,
      },
    })
    props.onBusy(true)
    try {
      const result = await props.ui2Host.loginProvider({
        agentDir: props.settings.providers?.agentDir ?? "",
        providerId: loginId,
      })
      if (result.ok) {
        if (result.snapshot) props.onSnapshot(result.snapshot)
        const who = [result.email, result.orgName ?? result.orgId].filter(Boolean).join(" / ")
        props.onStatus(who ? t("providers.loggedInAs", { who }) : t("providers.loginSuccess"))
      } else {
        const err = result.error ?? t("providers.loginFailed")
        const cancelled =
          err.toLowerCase().includes("cancel") || err.toLowerCase().includes("abort")
        if (!cancelled) props.onStatus(err)
      }
    } catch (e) {
      props.onStatus(e instanceof Error ? e.message : String(e))
    } finally {
      props.onBusy(false)
      setDialog({ kind: "none" })
    }
  }

  const onConnectResult = async (snap: ProviderSnapshot, result: ConnectResult, edit: boolean) => {
    setDialog({ kind: "none" })
    if (result.kind === "cancel") return
    if (result.kind === "login") {
      await runLogin(snap)
      return
    }
    const key = result.apiKey.trim()
    if (!key && edit) return
    if (!key) return
    await applyPatch(
      [],
      [{ provider: snap.id, action: "set", apiKey: key }],
    )
  }

  const onCustomResult = async (result: CustomResult, existing: ProviderSnapshot | null) => {
    setDialog({ kind: "none" })
    if (result.kind === "cancel") return
    const models = parseModelsText(result.modelsText).map((m) => ({
      id: m.id,
      name: m.name ?? null,
      api: m.api ?? null,
    }))
    const baseUrl = result.baseUrl || null
    const api = result.api || null
    const patch: ProviderPatch = {
      id: result.id,
      baseUrl,
      api,
      auth: existing?.auth ?? "none",
      models,
      clearBaseUrl: !baseUrl,
      clearApi: !api,
    }
    const credentials: CredentialAction[] = result.apiKey
      ? [{ provider: result.id, action: "set", apiKey: result.apiKey }]
      : []
    await applyPatch([patch], credentials)
  }

  const disconnect = async (snap: ProviderSnapshot) => {
    if (
      !confirm(
        t("providers.disconnectConfirm", { name: displayName(snap.id) }),
      )
    ) {
      return
    }
    if (!props.ui2Host) return
    props.onBusy(true)
    try {
      const result = await props.ui2Host.logoutProvider({
        agentDir: props.settings.providers?.agentDir ?? "",
        providerId: snap.id,
      })
      if (!result.ok) {
        props.onStatus(result.error ?? t("providers.logoutFailed"))
        return
      }
      if (result.snapshot) props.onSnapshot(result.snapshot)
    } catch (e) {
      props.onStatus(e instanceof Error ? e.message : String(e))
    } finally {
      props.onBusy(false)
    }
  }

  const deleteCustom = async (snap: ProviderSnapshot) => {
    if (!confirm(t("providers.deleteConfirm", { id: snap.id }))) {
      return
    }
    await applyPatch(
      [{ id: snap.id, remove: true }],
      [{ provider: snap.id, action: "clear" }],
    )
  }

  const catalogIds = () => {
    const ids = catalogProviderIds(props.catalog)
    for (const p of providers()) {
      if (p.isCatalog) ids.add(p.id)
    }
    return ids
  }

  return (
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="m-0 text-lg font-semibold text-fg">{t("settings.providers")}</h2>
          <p class="m-0 mt-1 text-xs text-muted">{t("providers.subtitle")}</p>
        </div>
        <button
          type="button"
          class="rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:border-accent disabled:opacity-50"
          disabled={props.busy}
          onClick={() => void reload()}
        >
          {props.busy ? t("common.loading") : t("providers.reload")}
        </button>
      </header>

      <Show when={props.catalogError}>
        {(e) => (
          <p class="m-0 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">
            {t("providers.catalogLoadFailed", { error: e() })}
          </p>
        )}
      </Show>

      <section class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="mb-1 block text-xs text-muted">{t("providers.agentDirectory")}</label>
          <input
            class="w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-sm text-fg"
            value={props.settings.providers?.agentDir ?? ""}
            placeholder="~/.omp/agent"
            onInput={(e) => onAgentDirInput(e.currentTarget.value)}
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-muted">{t("providers.defaultModel")}</label>
          <ModelPicker
            value={defaultSpec()}
            providers={providers()}
            catalog={props.catalog}
            pinnedSpecs={props.settings.modelPreferences?.pinnedModelSpecs ?? []}
            recentSpecs={props.settings.modelPreferences?.recentModelSpecs ?? []}
            allowClear
            ariaLabel={t("providers.defaultModel")}
            disabled={props.busy}
            onChange={onDefaultModel}
          />
        </div>
      </section>

      <section>
        <div class="mb-2 flex items-center justify-between">
          <h3 class="m-0 text-sm font-semibold text-fg">{t("providers.connectedProviders")}</h3>
          <button
            type="button"
            class="text-xs text-accent hover:underline"
            onClick={() => setDialog({ kind: "custom", existing: null })}
          >
            {t("providers.addCustom")}
          </button>
        </div>
        <Show
          when={classified().connected.length > 0}
          fallback={<p class="m-0 text-sm text-muted">{t("providers.noConnected")}</p>}
        >
          <ul class="m-0 list-none space-y-2 p-0">
            <For each={classified().connected}>
              {(snap) => (
                <ProviderRow
                  snap={snap}
                  onConnect={() => setDialog({ kind: "connect", snap, edit: false })}
                  onEdit={() => {
                    if (snap.isCatalog) {
                      setDialog({ kind: "connect", snap, edit: true })
                    } else {
                      setDialog({ kind: "custom", existing: snap })
                    }
                  }}
                  onDisconnect={() => void disconnect(snap)}
                  onDelete={() => void deleteCustom(snap)}
                />
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section>
        <h3 class="m-0 mb-2 text-sm font-semibold text-fg">{t("providers.builtInProviders")}</h3>
        <input
          class="mb-2 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg"
          placeholder={t("providers.searchPlaceholder")}
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
        <Show
          when={builtIn().length > 0}
          fallback={
            <p class="m-0 text-sm text-muted">
              {search().trim() ? t("providers.noMatch") : t("providers.noBuiltIn")}
            </p>
          }
        >
          <ul class="m-0 list-none space-y-2 p-0">
            <For each={builtIn()}>
              {(snap) => (
                <ProviderRow
                  snap={snap}
                  onConnect={() => setDialog({ kind: "connect", snap, edit: false })}
                  onEdit={() => setDialog({ kind: "connect", snap, edit: true })}
                  onDisconnect={() => void disconnect(snap)}
                  onDelete={() => undefined}
                />
              )}
            </For>
          </ul>
        </Show>
      </section>

      <Show when={dialog().kind === "connect"}>
        {(() => {
          const d = dialog()
          if (d.kind !== "connect") return null
          return (
            <ConnectDialog
              snapshot={d.snap}
              editMode={d.edit}
              onClose={(r) => void onConnectResult(d.snap, r, d.edit)}
            />
          )
        })()}
      </Show>

      <Show when={dialog().kind === "custom"}>
        {(() => {
          const d = dialog()
          if (d.kind !== "custom") return null
          const customIds = new Set(
            providers()
              .filter((p) => !p.isCatalog && p.id !== d.existing?.id)
              .map((p) => p.id),
          )
          return (
            <CustomProviderDialog
              existing={d.existing}
              catalogIds={catalogIds()}
              existingCustomIds={customIds}
              onClose={(r) => void onCustomResult(r, d.existing)}
            />
          )
        })()}
      </Show>

      <Show when={dialog().kind === "login"}>
        {(() => {
          const d = dialog()
          if (d.kind !== "login") return null
          return (
            <LoginOverlay
              state={d.state}
              onOpenBrowser={() => {
                const url = d.state.launchUrl || d.state.url
                if (url && props.ui2Host) void props.ui2Host.openExternalUrl(url)
              }}
              onCancel={() => {
                void props.ui2Host?.cancelProviderLogin()
              }}
              onSubmitInput={(text) => {
                d.state.resolveInput?.({ text, cancelled: false })
              }}
              onCancelInput={() => {
                d.state.resolveInput?.({ text: "", cancelled: true })
              }}
            />
          )
        })()}
      </Show>
    </div>
  )
}

function ProviderRow(props: {
  snap: ProviderSnapshot
  onConnect: () => void
  onEdit: () => void
  onDisconnect: () => void
  onDelete: () => void
}) {
  const t = useT()
  const labels = () => providerUiLabels(t)
  const badge = () => primaryBadge(props.snap)
  const connected = () =>
    !props.snap.isCatalog ||
    Boolean(props.snap.credential?.hasApiKey || props.snap.credential?.hasOAuth)

  return (
    <li class="flex flex-wrap items-start justify-between gap-2 rounded border border-border bg-surface/40 px-3 py-2">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium text-fg">{displayName(props.snap.id)}</span>
          <span class="rounded bg-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
            {badgeLabel(badge(), labels())}
          </span>
          <span class="font-mono text-[11px] text-muted">{props.snap.id}</span>
        </div>
        <p class="m-0 mt-0.5 text-xs text-muted">{description(props.snap.id)}</p>
      </div>
      <div class="flex shrink-0 flex-wrap gap-1">
        <Show when={!connected()}>
          <button
            type="button"
            class="rounded border border-border px-2 py-1 text-xs text-fg hover:border-accent"
            onClick={props.onConnect}
          >
            {t("common.connect")}
          </button>
        </Show>
        <Show when={connected()}>
          <button
            type="button"
            class="rounded border border-border px-2 py-1 text-xs text-fg hover:border-accent"
            onClick={props.onEdit}
          >
            {t("common.edit")}
          </button>
          <button
            type="button"
            class="rounded border border-border px-2 py-1 text-xs text-muted hover:border-accent"
            onClick={props.onDisconnect}
          >
            {t("common.disconnect")}
          </button>
        </Show>
        <Show when={!props.snap.isCatalog}>
          <button
            type="button"
            class="rounded border border-border px-2 py-1 text-xs text-red-400 hover:border-red-400"
            onClick={props.onDelete}
          >
            {t("common.delete")}
          </button>
        </Show>
      </div>
    </li>
  )
}
