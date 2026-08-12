import {useEffect, useRef} from "react"
import {mergeSettingMutations, type SettingMutation, settingKeys, setSetting} from "@vibefly/uiagent-shared"
import {applyUiLocale, useAppTranslation} from "../i18n"
import {type IdeSettings, type UiForm, withUi} from "./settingsStore"

export type GeneralPageProps = {
    settings: IdeSettings
    busy: boolean
    onSettings: (next: IdeSettings) => void
    onDraft: (mutations: readonly SettingMutation[]) => void
    onSave: (mutations: readonly SettingMutation[]) => Promise<void>
}

export function GeneralPage(props: GeneralPageProps) {
    const {t} = useAppTranslation(["settings"])
    const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const pendingSave = useRef<SettingMutation[]>([])
    const onSaveRef = useRef(props.onSave)
    onSaveRef.current = props.onSave
    useEffect(() => () => {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        const patch = pendingSave.current
        pendingSave.current = []
        if (patch.length > 0) void onSaveRef.current(patch)
    }, [])
    const locale = props.settings.ui?.locale ?? "follow_ide"
    const debounceSave = (next: IdeSettings, mutations: readonly SettingMutation[]) => {
        props.onDraft(mutations)
        props.onSettings(next)
        pendingSave.current = mergeSettingMutations(pendingSave.current, mutations)
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
            saveTimer.current = undefined
            const pending = pendingSave.current
            pendingSave.current = []
            if (pending.length > 0) void onSaveRef.current(pending)
        }, 300)
    }
    const onLocale = (value: UiForm["locale"]) => {
        applyUiLocale(value)
        debounceSave(withUi(props.settings, {locale: value}), [setSetting(settingKeys.ui.locale, value)])
    }
    return (
        <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
            <header>
                <h2 className="m-0 text-lg font-semibold text-fg">{t("settings:general")}</h2>
                <p className="m-0 mt-1 text-xs text-muted">{t("settings:generalSubtitle")}</p>
            </header>
            <section>
                <label className="mb-1 block text-xs text-muted">{t("settings:displayLanguage")}</label>
                <div className="flex flex-wrap gap-2">
                    {([
                        ["follow_ide", t("settings:followIde")],
                        ["en", t("settings:english")],
                        ["zh", t("settings:simplifiedChinese")],
                    ] as const).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            className={`rounded border px-3 py-1.5 text-sm ${locale === value ? "border-accent bg-surface text-fg" : "border-border text-muted"}`}
                            disabled={props.busy}
                            onClick={() => onLocale(value)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </section>
        </div>
    )
}
