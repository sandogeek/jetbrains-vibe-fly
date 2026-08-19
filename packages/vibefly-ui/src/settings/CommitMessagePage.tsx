import {type SettingMutation, settingKeys, setSetting} from "@vibefly/uiagent-shared"
import {useAppTranslation} from "../i18n"

import {useNavigate} from "react-router-dom"
import type {ProviderSnapshot, ProvidersSnapshot} from "./providerSnapshots"
import type {BundledCatalog} from "./catalog"
import {ModelPicker} from "./ModelPicker"
import type {SettingsMutateOptions} from "./settingsMutationQueue"
import type {SettingKeyStore} from "./settingKeyStore"
import {useSettingKey} from "./useSettingKey"

export type CommitMessagePageProps = {
    store: SettingKeyStore | null
    snapshot: ProvidersSnapshot | null
    catalog: BundledCatalog
    busy: boolean
    onMutate: (mutations: readonly SettingMutation[], options?: SettingsMutateOptions) => void
}

export function CommitMessagePage(props: CommitMessagePageProps) {
    const {t} = useAppTranslation(["commit", "settings"])
    const navigate = useNavigate()
    const providers: ProviderSnapshot[] = props.snapshot?.providers ?? []
    const defaultProvider = useSettingKey(props.store, settingKeys.defaultProvider)
    const defaultModel = useSettingKey(props.store, settingKeys.defaultModel)
    const commitModelSpec = useSettingKey(props.store, settingKeys.commit.commitModelSpec)
    const languageMode = useSettingKey(props.store, settingKeys.commit.languageMode)
    const useCustomPrompt = useSettingKey(props.store, settingKeys.commit.useCustomPrompt)
    const customPrompt = useSettingKey(props.store, settingKeys.commit.customPrompt)
    const pinnedModelSpecs = useSettingKey(props.store, settingKeys.modelPreferences.pinnedModelSpecs)
    const recentModelSpecs = useSettingKey(props.store, settingKeys.modelPreferences.recentModelSpecs)
    const defaultModelSpec = defaultProvider.trim() && defaultModel.trim()
        ? `${defaultProvider.trim()}/${defaultModel.trim()}`
        : ""
    const onModel = (spec: string, pinned: string[], recent: string[]) => props.onMutate([
        setSetting(settingKeys.commit.commitModelSpec, spec),
        setSetting(settingKeys.modelPreferences.pinnedModelSpecs, [...pinned]),
        setSetting(settingKeys.modelPreferences.recentModelSpecs, [...recent]),
    ])
    return <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <header><h2 className="m-0 text-lg font-semibold text-fg">{t("settings:commitMessage")}</h2><p
            className="m-0 mt-1 text-xs text-muted">{t("commit:subtitle")}</p></header>
        <section><label className="mb-1 block text-xs text-muted">{t("commit:language")}</label>
            <div
                className="flex flex-wrap gap-2">{([["follow_ide", t("commit:followIde")], ["en", t("commit:english")], ["zh", t("commit:simplifiedChinese")]] as const).map(([value, label]) =>
                <button key={value} type="button"
                        className={`rounded border px-3 py-1.5 text-sm ${languageMode === value ? "border-accent bg-surface text-fg" : "border-border text-muted"}`}
                        onClick={() => props.onMutate([setSetting(settingKeys.commit.languageMode, value)])}>{label}</button>)}</div>
        </section>
        <section><label className="mb-1 block text-xs text-muted">{t("commit:model")}</label>
            <ModelPicker
                value={commitModelSpec} providers={providers} catalog={props.catalog}
                pinnedSpecs={pinnedModelSpecs}
                recentSpecs={recentModelSpecs} allowFollowDefault
                ariaLabel={t("commit:model")} followDefaultSpec={defaultModelSpec}
                onConfigureProviders={() => navigate("/settings/providers")} disabled={props.busy} onChange={onModel}/>
            <p className="m-0 mt-1 text-[11px] text-muted">{t("commit:followDefaultHint")}</p>
        </section>
        <section>
            <label className="mb-2 flex items-center gap-2 text-sm text-fg">
                <input type="checkbox"
                       checked={Boolean(useCustomPrompt)}
                       onChange={(event) => props.onMutate([setSetting(settingKeys.commit.useCustomPrompt, event.currentTarget.checked)])}/>
                {t("commit:useCustomPrompt")}
            </label>
            <textarea
                className="h-40 w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-xs text-fg disabled:opacity-50"
                disabled={!useCustomPrompt} value={customPrompt}
                placeholder={t("commit:customPromptPlaceholder")}
                onChange={(event) => props.onMutate([setSetting(settingKeys.commit.customPrompt, event.currentTarget.value)])}/>
        </section>
    </div>
}
