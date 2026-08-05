import { useEffect, useRef } from "react"
import { useAppTranslation } from "../i18n"

import { useNavigate } from "react-router-dom"
import type { IdeSettingsDto } from "../generated/rpc"
import type { ProviderSnapshot, ProvidersSnapshot } from "./providerSnapshots"
import type { BundledCatalog } from "./catalog"
import { ModelPicker } from "./ModelPicker"
import { withCommit, withModelPreferences } from "./settingsStore"

export type CommitMessagePageProps = { settings: IdeSettingsDto; snapshot: ProvidersSnapshot | null; catalog: BundledCatalog; busy: boolean; onSettings: (next: IdeSettingsDto) => void; onSave: (settings: IdeSettingsDto) => Promise<void> }

export function CommitMessagePage(props: CommitMessagePageProps) {
  const { t } = useAppTranslation(["commit", "settings"]); const navigate = useNavigate(); const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])
  const providers: ProviderSnapshot[] = props.snapshot?.providers ?? []
  const defaultModelSpec = props.settings.providers?.defaultProvider?.trim() && props.settings.providers?.defaultModel?.trim() ? `${props.settings.providers.defaultProvider.trim()}/${props.settings.providers.defaultModel.trim()}` : ""
  const debounceSave = (next: IdeSettingsDto) => { props.onSettings(next); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => void props.onSave(next), 300) }
  const onModel = (spec: string, pinned: string[], recent: string[]) => debounceSave(withModelPreferences(withCommit(props.settings, { commitModelSpec: spec }), { pinnedModelSpecs: pinned, recentModelSpecs: recent }))
  const languageMode = props.settings.commit?.languageMode ?? "follow_ide"
  return <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
    <header><h2 className="m-0 text-lg font-semibold text-fg">{t("settings:commitMessage")}</h2><p className="m-0 mt-1 text-xs text-muted">{t("commit:subtitle")}</p></header>
    <section><label className="mb-1 block text-xs text-muted">{t("commit:language")}</label><div className="flex flex-wrap gap-2">{([["follow_ide", t("commit:followIde")], ["en", t("commit:english")], ["zh", t("commit:simplifiedChinese")]] as const).map(([value, label]) => <button key={value} type="button" className={`rounded border px-3 py-1.5 text-sm ${languageMode === value ? "border-accent bg-surface text-fg" : "border-border text-muted"}`} onClick={() => debounceSave(withCommit(props.settings, { languageMode: value }))}>{label}</button>)}</div></section>
    <section><label className="mb-1 block text-xs text-muted">{t("commit:model")}</label><ModelPicker value={props.settings.commit?.commitModelSpec ?? ""} providers={providers} catalog={props.catalog} pinnedSpecs={props.settings.modelPreferences?.pinnedModelSpecs ?? []} recentSpecs={props.settings.modelPreferences?.recentModelSpecs ?? []} allowFollowDefault ariaLabel={t("commit:model")} followDefaultSpec={defaultModelSpec} onConfigureProviders={() => navigate("/settings/providers")} disabled={props.busy} onChange={onModel} /><p className="m-0 mt-1 text-[11px] text-muted">{t("commit:followDefaultHint")}</p></section>
    <section><label className="mb-2 flex items-center gap-2 text-sm text-fg"><input type="checkbox" checked={Boolean(props.settings.commit?.useCustomPrompt)} onChange={(event) => debounceSave(withCommit(props.settings, { useCustomPrompt: event.currentTarget.checked }))} />{t("commit:useCustomPrompt")}</label><textarea className="h-40 w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-xs text-fg disabled:opacity-50" disabled={!props.settings.commit?.useCustomPrompt} value={props.settings.commit?.customPrompt ?? ""} placeholder={t("commit:customPromptPlaceholder")} onChange={(event) => debounceSave(withCommit(props.settings, { customPrompt: event.currentTarget.value }))} /></section>
  </div>
}
