import type {
  CommitFormDto,
  IdeSettingsDto,
  ModelPreferencesDto,
  ProvidersFormDto,
  ProvidersSnapshot,
  ProviderSnapshot,
} from "../generated/rpc"
import { emptyCatalog, type BundledCatalog } from "./catalog"

export type SettingsState = {
  settings: IdeSettingsDto
  snapshot: ProvidersSnapshot | null
  catalog: BundledCatalog
  catalogError: string | null
  loadError: string | null
  busy: boolean
  status: string | null
}

export function emptySettings(): IdeSettingsDto {
  return {
    providers: {
      agentDir: "",
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
  }
}

export function normalizeSettings(raw: IdeSettingsDto | null | undefined): IdeSettingsDto {
  const base = emptySettings()
  if (!raw) return base
  return {
    providers: {
      agentDir: raw.providers?.agentDir ?? "",
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
    catalog: emptyCatalog,
    catalogError: null,
    loadError: null,
    busy: false,
    status: null,
  }
}
