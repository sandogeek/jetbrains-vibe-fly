import { useNavigate } from "@solidjs/router"
import type { IdeSettingsDto, ProviderSnapshot, ProvidersSnapshot } from "../generated/rpc"
import { useT } from "../i18n"
import type { BundledCatalog } from "./catalog"
import { ModelPicker } from "./ModelPicker"
import { withCommit, withModelPreferences } from "./settingsStore"
export type CommitMessagePageProps = {
  settings: IdeSettingsDto
  snapshot: ProvidersSnapshot | null
  catalog: BundledCatalog
  busy: boolean
  onSettings: (next: IdeSettingsDto) => void
  onSave: (settings: IdeSettingsDto) => Promise<void>
}

export function CommitMessagePage(props: CommitMessagePageProps) {
  const t = useT()
  const navigate = useNavigate()
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  const providers = (): ProviderSnapshot[] => props.snapshot?.providers ?? []
  const defaultModelSpec = () => {
    const provider = props.settings.providers?.defaultProvider?.trim()
    const model = props.settings.providers?.defaultModel?.trim()
    return provider && model ? `${provider}/${model}` : ""
  }

  const debounceSave = (next: IdeSettingsDto) => {
    props.onSettings(next)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void props.onSave(next)
    }, 300)
  }

  const setLanguage = (mode: string) => {
    debounceSave(withCommit(props.settings, { languageMode: mode }))
  }

  const onModel = (spec: string, pinned: string[], recent: string[]) => {
    let next = withCommit(props.settings, { commitModelSpec: spec })
    next = withModelPreferences(next, {
      pinnedModelSpecs: pinned,
      recentModelSpecs: recent,
    })
    debounceSave(next)
  }

  return (
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <header>
        <h2 class="m-0 text-lg font-semibold text-fg">{t("settings.commitMessage")}</h2>
        <p class="m-0 mt-1 text-xs text-muted">{t("commit.subtitle")}</p>
      </header>

      <section>
        <label class="mb-1 block text-xs text-muted">{t("commit.language")}</label>
        <div class="flex flex-wrap gap-2">
          {(
            [
              ["follow_ide", t("commit.followIde")],
              ["en", t("commit.english")],
              ["zh", t("commit.simplifiedChinese")],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              class="rounded border px-3 py-1.5 text-sm"
              classList={{
                "border-accent bg-surface text-fg":
                  (props.settings.commit?.languageMode ?? "follow_ide") === value,
                "border-border text-muted":
                  (props.settings.commit?.languageMode ?? "follow_ide") !== value,
              }}
              onClick={() => setLanguage(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <label class="mb-1 block text-xs text-muted">{t("commit.model")}</label>
        <ModelPicker
          value={props.settings.commit?.commitModelSpec ?? ""}
          providers={providers()}
          catalog={props.catalog}
          pinnedSpecs={props.settings.modelPreferences?.pinnedModelSpecs ?? []}
          recentSpecs={props.settings.modelPreferences?.recentModelSpecs ?? []}
          allowFollowDefault
          ariaLabel={t("commit.model")}
          followDefaultSpec={defaultModelSpec()}
          onConfigureProviders={() => navigate("/settings/providers")}
          disabled={props.busy}
          onChange={onModel}
        />
        <p class="m-0 mt-1 text-[11px] text-muted">
          {t("commit.followDefaultHint")}
        </p>
      </section>

      <section>
        <label class="mb-2 flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={Boolean(props.settings.commit?.useCustomPrompt)}
            onChange={(e) =>
              debounceSave(
                withCommit(props.settings, { useCustomPrompt: e.currentTarget.checked }),
              )
            }
          />
          {t("commit.useCustomPrompt")}
        </label>
        <textarea
          class="h-40 w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-xs text-fg disabled:opacity-50"
          disabled={!props.settings.commit?.useCustomPrompt}
          value={props.settings.commit?.customPrompt ?? ""}
          placeholder={t("commit.customPromptPlaceholder")}
          onInput={(e) =>
            debounceSave(withCommit(props.settings, { customPrompt: e.currentTarget.value }))
          }
        />
      </section>
    </div>
  )
}
