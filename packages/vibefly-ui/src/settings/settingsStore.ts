import {normalizeUiLocaleMode} from "../i18n"
import {bundledCatalog, type BundledCatalog} from "./catalog"
import type {ProviderSnapshot, ProvidersSnapshot} from "./providerSnapshots"

export type ProvidersForm = {
    defaultProvider: string
    defaultModel: string
}

export type CommitForm = {
    languageMode: string
    commitModelSpec: string
    useCustomPrompt: boolean
    customPrompt: string
}

export type ModelPreferences = {
    recentModelSpecs: string[]
    pinnedModelSpecs: string[]
}

export type UiForm = {
    locale: string
}

export type IdeSettings = {
    providers: ProvidersForm
    commit: CommitForm
    modelPreferences: ModelPreferences
    ui: UiForm
}

export type SettingsState = {
    settings: IdeSettings
    snapshot: ProvidersSnapshot | null
    catalog: BundledCatalog
    loadError: string | null
    busy: boolean
    status: string | null
}

export function emptySettings(): IdeSettings {
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

export function normalizeSettings(raw: IdeSettings | null | undefined): IdeSettings {
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
    settings: IdeSettings,
    patch: Partial<ProvidersForm>,
): IdeSettings {
    return {
        ...settings,
        providers: {...settings.providers!, ...patch},
    }
}

export function withCommit(settings: IdeSettings, patch: Partial<CommitForm>): IdeSettings {
    return {
        ...settings,
        commit: {...settings.commit!, ...patch},
    }
}

export function withUi(settings: IdeSettings, patch: Partial<UiForm>): IdeSettings {
    return {
        ...settings,
        ui: {
            locale: normalizeUiLocaleMode(patch.locale ?? settings.ui?.locale),
        },
    }
}

export function withModelPreferences(
    settings: IdeSettings,
    patch: Partial<ModelPreferences>,
): IdeSettings {
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
