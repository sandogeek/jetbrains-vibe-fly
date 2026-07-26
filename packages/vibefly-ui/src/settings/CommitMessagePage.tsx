import type { IdeSettingsDto, ProviderSnapshot, ProvidersSnapshot } from "../generated/rpc"
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
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  const providers = (): ProviderSnapshot[] => props.snapshot?.providers ?? []

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
    <div class="flex h-full flex-col gap-4 overflow-auto p-4">
      <header>
        <h2 class="m-0 text-lg font-semibold text-fg">Commit Message</h2>
        <p class="m-0 mt-1 text-xs text-muted">
          Language, model, and optional custom prompt for VCS commit generation.
        </p>
      </header>

      <section>
        <label class="mb-1 block text-xs text-muted">Commit message language</label>
        <div class="flex flex-wrap gap-2">
          {(
            [
              ["follow_ide", "Follow IDE"],
              ["en", "English"],
              ["zh", "简体中文"],
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
        <label class="mb-1 block text-xs text-muted">Commit model</label>
        <ModelPicker
          value={props.settings.commit?.commitModelSpec ?? ""}
          providers={providers()}
          catalog={props.catalog}
          pinnedSpecs={props.settings.modelPreferences?.pinnedModelSpecs ?? []}
          recentSpecs={props.settings.modelPreferences?.recentModelSpecs ?? []}
          allowFollowDefault
          disabled={props.busy}
          onChange={onModel}
        />
        <p class="m-0 mt-1 text-[11px] text-muted">
          Empty selection follows the Providers default model
          {props.settings.providers?.defaultProvider
            ? ` (${props.settings.providers.defaultProvider}/${props.settings.providers.defaultModel})`
            : ""}
          .
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
          Use custom system prompt
        </label>
        <textarea
          class="h-40 w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-xs text-fg disabled:opacity-50"
          disabled={!props.settings.commit?.useCustomPrompt}
          value={props.settings.commit?.customPrompt ?? ""}
          placeholder="Replaces the built-in Conventional Commits prompt. Language constraints still apply."
          onInput={(e) =>
            debounceSave(withCommit(props.settings, { customPrompt: e.currentTarget.value }))
          }
        />
      </section>
    </div>
  )
}

