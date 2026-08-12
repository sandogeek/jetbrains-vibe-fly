import type {VibeflyCommitSettings, VibeflyModelPreferences, VibeflyUiSettings,} from "@vibefly/uiagent-shared"
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

export function snapshotProviders(snapshot: ProvidersSnapshot | null): ProviderSnapshot[] {
    return snapshot?.providers ?? []
}

export function initialState(): SettingsState {
    return {
        snapshot: null,
        catalog: bundledCatalog,
        loadError: null,
        busy: false,
        status: null,
    }
}
