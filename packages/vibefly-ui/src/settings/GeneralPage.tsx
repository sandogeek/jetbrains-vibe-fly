import {type SettingMutation, settingKeys, setSetting} from "@vibefly/uiagent-shared"
import {applyUiLocale, useAppTranslation} from "../i18n"
import {type IdeSettings} from "./settingsStore"
import type {SettingsMutateOptions} from "./settingsMutationQueue"

export type GeneralPageProps = {
    settings: IdeSettings
    busy: boolean
    onMutate: (mutations: readonly SettingMutation[], options?: SettingsMutateOptions) => void
}

export function GeneralPage(props: GeneralPageProps) {
    const {t} = useAppTranslation(["settings"])
    const locale = props.settings.ui?.locale ?? "follow_ide"
    const onLocale = (value: IdeSettings["ui"]["locale"]) => {
        applyUiLocale(value)
        props.onMutate([setSetting(settingKeys.ui.locale, value)], {immediate: true})
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
