import {
    type SettingMutation,
    settingKeys,
    setSetting,
} from "@vibefly/uiagent-shared"
import type {ModelPreferences} from "./settingsStore"

export function modelPreferenceMutations(preferences: ModelPreferences): SettingMutation[] {
    return [
        setSetting(settingKeys.modelPreferences.recentModelSpecs, [...preferences.recentModelSpecs]),
        setSetting(settingKeys.modelPreferences.pinnedModelSpecs, [...preferences.pinnedModelSpecs]),
    ]
}
