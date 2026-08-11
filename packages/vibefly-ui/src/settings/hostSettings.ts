import {
    selectSetting,
    type SafeSettingsSnapshot,
    type SettingMutation,
    settingKeys,
    type SettingsChanged,
    type SettingsDiagnostic,
    type SettingsFileName,
    type SettingsSyncState,
    setSetting,
} from "@vibefly/uiagent-shared"
import type {UiSettingsSnapshot} from "../generated/rpc"
import {type IdeSettings, type ModelPreferences} from "./settingsStore"

const SETTINGS_FILES = new Set<string>([
    "settings.json",
    "settings.vibefly.json",
    "models.json",
    "auth.json",
] satisfies SettingsFileName[])

function normalizeJsonObjectDocument(raw: unknown): string {
    let parsed: unknown
    try {
        parsed = JSON.parse(String(raw ?? "{}"))
    } catch {
        return "{}"
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "{}"
    return JSON.stringify(parsed)
}

function safeDiagnostics(raw: UiSettingsSnapshot["diagnostics"]): SettingsDiagnostic[] {
    const diagnostics: SettingsDiagnostic[] = []
    for (const item of raw ?? []) {
        if (!SETTINGS_FILES.has(item.file)) continue
        if (item.severity !== "error" && item.severity !== "warning") continue
        diagnostics.push({
            file: item.file as SettingsFileName,
            severity: item.severity,
            message: String(item.message),
        })
    }
    return diagnostics
}

/** Normalize the WebView-safe wire projection without exposing agent-only documents. */
export function safeUiSettingsSnapshot(raw: UiSettingsSnapshot): SafeSettingsSnapshot {
    const common = {
        settingsJson: normalizeJsonObjectDocument(raw.settingsJson),
        vibeflyJson: normalizeJsonObjectDocument(raw.vibeflyJson),
        revision: String(raw.revision),
        diagnostics: safeDiagnostics(raw.diagnostics),
    }
    if (raw.scope === "application") {
        if (raw.projectRoot != null) {
            throw new Error("Application settings snapshot must not include a project root")
        }
        return {...common, scope: "application", projectRoot: null}
    }
    if (raw.scope === "project") {
        const projectRoot = raw.projectRoot?.trim()
        if (!projectRoot) throw new Error("Project settings snapshot is missing its project root")
        return {...common, scope: "project", projectRoot}
    }
    throw new Error(`Unsupported settings scope: ${raw.scope}`)
}

export function settingsChanged(
    scope: string,
    projectRoot: string | null,
    revision: string,
): SettingsChanged | null {
    if (scope !== "application" && scope !== "project") return null
    return {scope, projectRoot, revision}
}

export function settingsFromState(state: SettingsSyncState<SafeSettingsSnapshot>): IdeSettings {
    return {
        providers: {
            defaultProvider: selectSetting(settingKeys.defaultProvider)(state),
            defaultModel: selectSetting(settingKeys.defaultModel)(state),
        },
        commit: {
            languageMode: selectSetting(settingKeys.commitLanguageMode)(state),
            commitModelSpec: selectSetting(settingKeys.commitModelSpec)(state),
            useCustomPrompt: selectSetting(settingKeys.commitUseCustomPrompt)(state),
            customPrompt: selectSetting(settingKeys.commitCustomPrompt)(state),
        },
        modelPreferences: {
            recentModelSpecs: [...selectSetting(settingKeys.recentModelSpecs)(state)],
            pinnedModelSpecs: [...selectSetting(settingKeys.pinnedModelSpecs)(state)],
        },
        ui: {
            locale: selectSetting(settingKeys.uiLocale)(state),
        },
    }
}

export function modelPreferenceMutations(preferences: ModelPreferences): SettingMutation[] {
    return [
        setSetting(settingKeys.recentModelSpecs, [...preferences.recentModelSpecs]),
        setSetting(settingKeys.pinnedModelSpecs, [...preferences.pinnedModelSpecs]),
    ]
}

export function diagnosticsText(state: SettingsSyncState<SafeSettingsSnapshot>): string | null {
    return state.effective.diagnostics
        .map((item) => `${item.file}: ${item.message}`)
        .join("; ") || null
}
