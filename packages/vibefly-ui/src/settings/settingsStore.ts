import type {VibeflyCommitSettings, VibeflyModelPreferences, VibeflyUiSettings,} from "@vibefly/uiagent-shared"
import {normalizeUiLocaleMode} from "../i18n"
import {bundledCatalog, type BundledCatalog} from "./catalog"
import type {ProviderSnapshot, ProvidersSnapshot} from "./providerSnapshots"

/** Drop JsonObject index signature; make known keys required and non-null for form state. */
type FormOf<T> = {
    [K in keyof T as string extends K ? never : K]-?: Exclude<T[K], null | undefined>
}

/** Pi settings.json fields edited in the providers UI. */
export type ProvidersForm = {
    defaultProvider: string
    defaultModel: string
}

export type CommitForm = FormOf<VibeflyCommitSettings>
export type ModelPreferences = FormOf<VibeflyModelPreferences>
export type UiForm = FormOf<VibeflyUiSettings>

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

export function withProviders(
    settings: IdeSettings,
    patch: Partial<ProvidersForm>,
): IdeSettings {
    return {
        ...settings,
        providers: {...settings.providers, ...patch},
    }
}

export function withCommit(settings: IdeSettings, patch: Partial<CommitForm>): IdeSettings {
    return {
        ...settings,
        commit: {...settings.commit, ...patch},
    }
}

export function withUi(settings: IdeSettings, patch: Partial<UiForm>): IdeSettings {
    return {
        ...settings,
        ui: {
            locale: normalizeUiLocaleMode(patch.locale ?? settings.ui.locale),
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
            recentModelSpecs: patch.recentModelSpecs ?? settings.modelPreferences.recentModelSpecs,
            pinnedModelSpecs: patch.pinnedModelSpecs ?? settings.modelPreferences.pinnedModelSpecs,
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
