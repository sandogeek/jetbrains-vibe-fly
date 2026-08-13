import {defaultSettingValues, settingKeys, type SettingValuesOf} from "@vibefly/uiagent-shared"
import {bundledCatalog, type BundledCatalog} from "./catalog"
import type {ProviderSnapshot, ProvidersSnapshot} from "./providerSnapshots"

/**
 * Unique UI grouping of typed keys. View-model types and defaults are derived from this tree.
 * 唯一的 UI key 映射树。视图模型类型与默认值都从这棵树推导。
 */
export const ideSettingKeys = {
    providers: {
        defaultProvider: settingKeys.defaultProvider,
        defaultModel: settingKeys.defaultModel,
    },
    commit: settingKeys.commit,
    modelPreferences: settingKeys.modelPreferences,
    ui: settingKeys.ui,
} as const

export type IdeSettings = SettingValuesOf<typeof ideSettingKeys>
export type ModelPreferences = IdeSettings["modelPreferences"]

export type SettingsState = {
    snapshot: ProvidersSnapshot | null
    catalog: BundledCatalog
    loadError: string | null
    busy: boolean
    status: string | null
}

export function emptySettings(): IdeSettings {
    return defaultSettingValues(ideSettingKeys)
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
