import { useEffect, useMemo, useState } from "react"
import type { CredentialAction, IdeSettingsDto, ProviderPatch, Ui2Host } from "../generated/rpc"
import { useT } from "../i18n"
import type { BundledCatalog } from "./catalog"
import { catalogProviderIds } from "./catalog"
import { ConnectDialog, CustomProviderDialog, LoginOverlay, parseModelsText, providerUiLabels, type ConnectResult, type CustomResult, type LoginOverlayState } from "./dialogs"
import { ModelPicker } from "./ModelPicker"
import { badgeLabel, classifyProviders, filterBuiltInProviders, modelSpec, parseModelSpec, primaryBadge } from "./providerLogic"
import { description, displayName } from "./providerLabels"
import { PROVIDER_CONFIG_RPC_OPTIONS, PROVIDER_LOGIN_RPC_OPTIONS } from "./rpcOptions"
import { withModelPreferences, withProviders } from "./settingsStore"
import { mergeProvidersSnapshot, type ProviderSnapshot, type ProvidersSnapshot } from "./providerSnapshots"

export type ProvidersPageProps = { ui2Host: Ui2Host | null; settings: IdeSettingsDto; snapshot: ProvidersSnapshot | null; catalog: BundledCatalog; busy: boolean; onSettings: (next: IdeSettingsDto) => void; onSnapshot: (snap: ProvidersSnapshot | null) => void; onBusy: (busy: boolean) => void; onStatus: (msg: string | null) => void; onSave: (settings: IdeSettingsDto) => Promise<void>; registerLoginHandlers?: (handlers: { onOpenUrl: (url: string, launchUrl: string | null) => void; onProgress: (message: string) => void; onRequestInput: (prompt: string, placeholder: string | null) => Promise<{ text?: string; cancelled?: boolean }> } | null) => void }
type DialogState = { kind: "none" } | { kind: "connect"; snap: ProviderSnapshot; edit: boolean } | { kind: "custom"; existing: ProviderSnapshot | null } | { kind: "login"; state: LoginOverlayState }

export function ProvidersPage(props: ProvidersPageProps) {
  const t = useT(); const [search, setSearch] = useState(""); const [dialog, setDialog] = useState<DialogState>({ kind: "none" })
  useEffect(() => {
    props.registerLoginHandlers?.({
      onOpenUrl: (url, launchUrl) => setDialog((current) => current.kind === "login" ? { kind: "login", state: { ...current.state, url, launchUrl, progress: t("providers.waitingAuth") } } : current),
      onProgress: (message) => setDialog((current) => current.kind === "login" ? { kind: "login", state: { ...current.state, progress: message } } : current),
      onRequestInput: (prompt, placeholder) => new Promise((resolve) => setDialog((current) => { if (current.kind !== "login") { resolve({ text: "", cancelled: true }); return current } return { kind: "login", state: { ...current.state, inputPrompt: prompt, inputPlaceholder: placeholder, resolveInput: resolve } } })),
    })
    return () => props.registerLoginHandlers?.(null)
  }, [props.registerLoginHandlers, t])

  const providers = props.snapshot?.providers ?? []
  const classified = useMemo(() => classifyProviders(providers), [providers])
  const builtIn = useMemo(() => filterBuiltInProviders(classified.popular, search), [classified.popular, search])
  const defaultSpec = modelSpec(props.settings.providers?.defaultProvider ?? "", props.settings.providers?.defaultModel ?? "")
  const scheduleSave = (next: IdeSettingsDto) => { props.onSettings(next); void props.onSave(next) }
  const onDefaultModel = (spec: string, pinned: string[], recent: string[]) => { const { provider, model } = parseModelSpec(spec); scheduleSave(withModelPreferences(withProviders(props.settings, { defaultProvider: provider, defaultModel: model }), { pinnedModelSpecs: pinned, recentModelSpecs: recent })) }

  const reload = async () => {
    if (!props.ui2Host) return props.onStatus(t("settings.hostUnavailable"))
    props.onBusy(true); props.onStatus(null); const startedAt = performance.now()
    try { const result = await props.ui2Host.refreshProviders(PROVIDER_CONFIG_RPC_OPTIONS); if (!result.ok) props.onStatus(result.error ?? t("settings.refreshFailed")); else props.onSnapshot(mergeProvidersSnapshot(result.snapshot, props.catalog)); console.log(`providers reload done in ${Math.round(performance.now() - startedAt)}ms`) }
    catch (error) { props.onStatus(error instanceof Error ? error.message : String(error)) }
    finally { props.onBusy(false) }
  }
  const applyPatch = async (providersPatch: ProviderPatch[], credentials: CredentialAction[] = []) => {
    if (!props.ui2Host) return props.onStatus(t("settings.hostUnavailableShort"))
    props.onBusy(true); props.onStatus(null)
    try { const result = await props.ui2Host.applyProvidersPatch({ providers: providersPatch, credentials }, PROVIDER_CONFIG_RPC_OPTIONS); if (!result.ok) props.onStatus(result.error ?? t("providers.saveFailed")); else if (result.snapshot) props.onSnapshot(mergeProvidersSnapshot(result.snapshot, props.catalog)) }
    catch (error) { props.onStatus(error instanceof Error ? error.message : String(error)) }
    finally { props.onBusy(false) }
  }
  const runLogin = async (snap: ProviderSnapshot) => {
    if (!props.ui2Host) return
    const loginId = snap.loginProviderId?.trim() || snap.id; const name = displayName(snap.id)
    setDialog({ kind: "login", state: { providerName: name, progress: t("providers.startingLogin", { name }), url: null, launchUrl: null, inputPrompt: null, inputPlaceholder: null } }); props.onBusy(true)
    try { const result = await props.ui2Host.loginProvider({ providerId: loginId }, PROVIDER_LOGIN_RPC_OPTIONS); if (result.ok) { if (result.snapshot) props.onSnapshot(mergeProvidersSnapshot(result.snapshot, props.catalog)); const who = [result.email, result.orgName ?? result.orgId].filter(Boolean).join(" / "); props.onStatus(who ? t("providers.loggedInAs", { who }) : t("providers.loginSuccess")) } else { const message = result.error ?? t("providers.loginFailed"); if (!/cancel|abort/i.test(message)) props.onStatus(message) } }
    catch (error) { props.onStatus(error instanceof Error ? error.message : String(error)) }
    finally { props.onBusy(false); setDialog({ kind: "none" }) }
  }
  const onConnectResult = async (snap: ProviderSnapshot, result: ConnectResult, edit: boolean) => { setDialog({ kind: "none" }); if (result.kind === "cancel") return; if (result.kind === "login") return runLogin(snap); const key = result.apiKey.trim(); if (key && (!edit || key)) await applyPatch([], [{ provider: snap.id, action: "set", apiKey: key }]) }
  const onCustomResult = async (result: CustomResult) => { setDialog({ kind: "none" }); if (result.kind === "cancel") return; const models = parseModelsText(result.modelsText).map((model) => ({ id: model.id, name: model.name ?? null, api: model.api ?? null })); const baseUrl = result.baseUrl || null; const api = result.api || null; await applyPatch([{ id: result.id, baseUrl, api, models, clearBaseUrl: !baseUrl, clearApi: !api }], result.apiKey ? [{ provider: result.id, action: "set", apiKey: result.apiKey }] : []) }
  const disconnect = async (snap: ProviderSnapshot) => { if (!confirm(t("providers.disconnectConfirm", { name: displayName(snap.id) })) || !props.ui2Host) return; props.onBusy(true); try { const result = await props.ui2Host.logoutProvider({ providerId: snap.id }, PROVIDER_CONFIG_RPC_OPTIONS); if (!result.ok) props.onStatus(result.error ?? t("providers.logoutFailed")); else if (result.snapshot) props.onSnapshot(mergeProvidersSnapshot(result.snapshot, props.catalog)) } catch (error) { props.onStatus(error instanceof Error ? error.message : String(error)) } finally { props.onBusy(false) } }
  const deleteCustom = async (snap: ProviderSnapshot) => { if (confirm(t("providers.deleteConfirm", { id: snap.id }))) await applyPatch([{ id: snap.id, remove: true }], [{ provider: snap.id, action: "clear" }]) }
  const catalogIds = () => { const ids = catalogProviderIds(props.catalog); for (const provider of providers) if (provider.isCatalog) ids.add(provider.id); return ids }
  const customIds = dialog.kind === "custom" ? new Set(providers.filter((provider) => !provider.isCatalog && provider.id !== dialog.existing?.id).map((provider) => provider.id)) : new Set<string>()

  return <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="m-0 text-lg font-semibold text-fg">{t("settings.providers")}</h2><p className="m-0 mt-1 text-xs text-muted">{t("providers.subtitle")}</p></div><button type="button" className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:border-accent disabled:opacity-50" disabled={props.busy} onClick={() => void reload()}>{props.busy ? t("common.loading") : t("providers.reload")}</button></header>
    <section><label className="mb-1 block text-xs text-muted">{t("providers.defaultModel")}</label><ModelPicker value={defaultSpec} providers={providers} catalog={props.catalog} pinnedSpecs={props.settings.modelPreferences?.pinnedModelSpecs ?? []} recentSpecs={props.settings.modelPreferences?.recentModelSpecs ?? []} allowClear ariaLabel={t("providers.defaultModel")} disabled={props.busy} onChange={onDefaultModel} /></section>
    <section><div className="mb-2 flex items-center justify-between"><h3 className="m-0 text-sm font-semibold text-fg">{t("providers.connectedProviders")}</h3><button type="button" className="text-xs text-accent hover:underline" onClick={() => setDialog({ kind: "custom", existing: null })}>{t("providers.addCustom")}</button></div>{classified.connected.length > 0 ? <ul className="m-0 list-none space-y-2 p-0">{classified.connected.map((snap) => <ProviderRow key={snap.id} snap={snap} onConnect={() => setDialog({ kind: "connect", snap, edit: false })} onEdit={() => setDialog(snap.isCatalog ? { kind: "connect", snap, edit: true } : { kind: "custom", existing: snap })} onDisconnect={() => void disconnect(snap)} onDelete={() => void deleteCustom(snap)} />)}</ul> : <p className="m-0 text-sm text-muted">{t("providers.noConnected")}</p>}</section>
    <section><h3 className="m-0 mb-2 text-sm font-semibold text-fg">{t("providers.builtInProviders")}</h3><input className="mb-2 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg" placeholder={t("providers.searchPlaceholder")} value={search} onChange={(event) => setSearch(event.currentTarget.value)} />{builtIn.length > 0 ? <ul className="m-0 list-none space-y-2 p-0">{builtIn.map((snap) => <ProviderRow key={snap.id} snap={snap} onConnect={() => setDialog({ kind: "connect", snap, edit: false })} onEdit={() => setDialog({ kind: "connect", snap, edit: true })} onDisconnect={() => void disconnect(snap)} onDelete={() => undefined} />)}</ul> : <p className="m-0 text-sm text-muted">{search.trim() ? t("providers.noMatch") : t("providers.noBuiltIn")}</p>}</section>
    {dialog.kind === "connect" && <ConnectDialog snapshot={dialog.snap} editMode={dialog.edit} onClose={(result) => void onConnectResult(dialog.snap, result, dialog.edit)} />}
    {dialog.kind === "custom" && <CustomProviderDialog existing={dialog.existing} catalogIds={catalogIds()} existingCustomIds={customIds} onClose={(result) => void onCustomResult(result)} />}
    {dialog.kind === "login" && <LoginOverlay state={dialog.state} onOpenBrowser={() => { const url = dialog.state.launchUrl || dialog.state.url; if (url) void props.ui2Host?.openExternalUrl(url) }} onCancel={() => void props.ui2Host?.cancelProviderLogin()} onSubmitInput={(text) => { dialog.state.resolveInput?.({ text, cancelled: false }); setDialog({ kind: "none" }) }} onCancelInput={() => { dialog.state.resolveInput?.({ text: "", cancelled: true }); setDialog({ kind: "none" }) }} />}
  </div>
}

function ProviderRow({ snap, onConnect, onEdit, onDisconnect, onDelete }: { snap: ProviderSnapshot; onConnect: () => void; onEdit: () => void; onDisconnect: () => void; onDelete: () => void }) {
  const t = useT(); const labels = providerUiLabels(t); const badge = primaryBadge(snap); const connected = !snap.isCatalog || Boolean(snap.credential?.hasApiKey || snap.credential?.hasOAuth)
  return <li className="flex flex-wrap items-start justify-between gap-2 rounded border border-border bg-surface/40 px-3 py-2"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium text-fg">{displayName(snap.id)}</span><span className="rounded bg-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">{badgeLabel(badge, labels)}</span><span className="font-mono text-[11px] text-muted">{snap.id}</span></div><p className="m-0 mt-0.5 text-xs text-muted">{description(snap.id)}</p></div><div className="flex shrink-0 flex-wrap gap-1">{!connected && <button type="button" className="rounded border border-border px-2 py-1 text-xs text-fg hover:border-accent" onClick={onConnect}>{t("common.connect")}</button>}{connected && <><button type="button" className="rounded border border-border px-2 py-1 text-xs text-fg hover:border-accent" onClick={onEdit}>{t("common.edit")}</button><button type="button" className="rounded border border-border px-2 py-1 text-xs text-muted hover:border-accent" onClick={onDisconnect}>{t("common.disconnect")}</button></>}{!snap.isCatalog && <button type="button" className="rounded border border-border px-2 py-1 text-xs text-red-400 hover:border-red-400" onClick={onDelete}>{t("common.delete")}</button>}</div></li>
}
