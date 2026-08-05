import { useEffect, useRef } from "react"
import { applyUiLocale, useAppTranslation } from "../i18n"
import type { IdeSettingsDto } from "../generated/rpc"
import { withUi } from "./settingsStore"

export type GeneralPageProps = {
  settings: IdeSettingsDto
  busy: boolean
  onSettings: (next: IdeSettingsDto) => void
  onSave: (settings: IdeSettingsDto) => Promise<void>
}

export function GeneralPage(props: GeneralPageProps) {
  const { t } = useAppTranslation(["settings"])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])
  const locale = props.settings.ui?.locale ?? "follow_ide"
  const debounceSave = (next: IdeSettingsDto) => {
    props.onSettings(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void props.onSave(next), 300)
  }
  const onLocale = (value: string) => {
    applyUiLocale(value)
    debounceSave(withUi(props.settings, { locale: value }))
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
