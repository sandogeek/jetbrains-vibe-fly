import type {
  CommitFormDto,
  IdeSettingsDto,
  ModelPreferencesDto,
  ProvidersFormDto,
  UiFormDto,
} from "../generated/rpc"
import { normalizeUiLocaleMode } from "../i18n"
import { bundledCatalog, type BundledCatalog } from "./catalog"
import type { ProviderSnapshot, ProvidersSnapshot } from "./providerSnapshots"

export type SettingsState = {
  settings: IdeSettingsDto
  snapshot: ProvidersSnapshot | null
  catalog: BundledCatalog
  loadError: string | null
  busy: boolean
  status: string | null
}

export function emptySettings(): IdeSettingsDto {
  return {
    providers: {
      defaultProvider: "",
      defaultModel: "",
    },
    commit: {
      languageMode: "follow_ide",
      commitModelSpec: "",
      useCustomPrompt: false,
      customPrompt: "",
    },
    modelPreferences: {
      recentModelSpecs: [],
      pinnedModelSpecs: [],
    },
    ui: {
      locale: "follow_ide",
    },
  }
}

export function normalizeSettings(raw: IdeSettingsDto | null | undefined): IdeSettingsDto {
  const base = emptySettings()
  if (!raw) return base
  return {
    providers: {
      defaultProvider: raw.providers?.defaultProvider ?? "",
      defaultModel: raw.providers?.defaultModel ?? "",
    },
    commit: {
      languageMode: raw.commit?.languageMode ?? "follow_ide",
      commitModelSpec: raw.commit?.commitModelSpec ?? "",
      useCustomPrompt: Boolean(raw.commit?.useCustomPrompt),
      customPrompt: raw.commit?.customPrompt ?? "",
    },
    modelPreferences: {
      recentModelSpecs: [...(raw.modelPreferences?.recentModelSpecs ?? [])],
      pinnedModelSpecs: [...(raw.modelPreferences?.pinnedModelSpecs ?? [])],
    },
    ui: {
      locale: normalizeUiLocaleMode(raw.ui?.locale),
    },
  }
}

export function withProviders(
  settings: IdeSettingsDto,
  patch: Partial<ProvidersFormDto>,
): IdeSettingsDto {
  return {
    ...settings,
    providers: { ...settings.providers!, ...patch },
  }
}

export function withCommit(settings: IdeSettingsDto, patch: Partial<CommitFormDto>): IdeSettingsDto {
  return {
    ...settings,
    commit: { ...settings.commit!, ...patch },
  }
}

export function withUi(settings: IdeSettingsDto, patch: Partial<UiFormDto>): IdeSettingsDto {
  return {
    ...settings,
    ui: {
      locale: normalizeUiLocaleMode(patch.locale ?? settings.ui?.locale),
    },
  }
}

export function withModelPreferences(
  settings: IdeSettingsDto,
  patch: Partial<ModelPreferencesDto>,
): IdeSettingsDto {
  return {
    ...settings,
    modelPreferences: {
      recentModelSpecs: patch.recentModelSpecs ?? settings.modelPreferences?.recentModelSpecs ?? [],
      pinnedModelSpecs: patch.pinnedModelSpecs ?? settings.modelPreferences?.pinnedModelSpecs ?? [],
    },
  }
}

export function snapshotProviders(snapshot: ProvidersSnapshot | null): ProviderSnapshot[] {
  return snapshot?.providers ?? []
}

export function initialState(): SettingsState {
  return {
    settings: emptySettings(),
    snapshot: null,
    catalog: bundledCatalog,
    loadError: null,
    busy: false,
    status: null,
  }
}
