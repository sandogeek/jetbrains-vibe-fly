import {
    type EffectiveSettings,
    parseJsonObjectDocument,
    parseVibeflySettingsJson,
    type SafeApplicationSettingsSnapshot,
    type SafeProjectSettingsSnapshot,
    type SafeSettingsSnapshot,
    setJsonAtPath,
    type SettingsChanged,
    type SettingsDiagnostic,
    type SettingsFileName,
    SettingsManager,
} from "@vibefly/uiagent-shared"
import type {Ui2Host, UiSettingsSnapshot} from "../generated/rpc"
import {
    type CommitForm,
    emptySettings,
    type IdeSettings,
    type ModelPreferences,
    type ProvidersForm,
    type UiForm,
    withCommit,
    withModelPreferences,
    withProviders,
    withUi,
} from "./settingsStore"

const SETTINGS_FILES = new Set<string>([
    "settings.json",
    "settings.vibefly.json",
    "models.json",
    "auth.json",
] satisfies SettingsFileName[])

const PROVIDER_KEYS = ["defaultProvider", "defaultModel"] as const satisfies ReadonlyArray<keyof ProvidersForm>
const COMMIT_KEYS = [
    "languageMode",
    "commitModelSpec",
    "useCustomPrompt",
    "customPrompt",
] as const satisfies ReadonlyArray<keyof CommitForm>
const PREFERENCE_KEYS = [
    "recentModelSpecs",
    "pinnedModelSpecs",
] as const satisfies ReadonlyArray<keyof ModelPreferences>
const FORM_GROUPS = ["providers", "commit", "modelPreferences", "ui"] as const

/** settings.json / settings.vibefly.json are opaque objects (no secrets; auth lives elsewhere). */
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

/** Normalize Host UI settings snapshot; preserve unknown keys for forward-compatible saves. */
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

export function createUiSettingsManager(ui2Host: Ui2Host): SettingsManager<SafeSettingsSnapshot> {
    return new SettingsManager({
        async getSettingsSnapshot(scope) {
            return safeUiSettingsSnapshot(await ui2Host.getSettingsSnapshot(scope))
        },
    })
}

export function settingsChanged(scope: string, projectRoot: string | null, revision: string): SettingsChanged | null {
    if (scope !== "application" && scope !== "project") return null
    return {scope, projectRoot, revision}
}

/** Map validated EffectiveSettings into required UI form state. */
export function formFromEffective(effective: EffectiveSettings): IdeSettings {
    const empty = emptySettings()
    const {settings, vibefly} = effective
    return {
        providers: {
            defaultProvider: settings.defaultProvider ?? empty.providers.defaultProvider,
            defaultModel: settings.defaultModel ?? empty.providers.defaultModel,
        },
        commit: {
            languageMode: vibefly.commit?.languageMode ?? empty.commit.languageMode,
            commitModelSpec: vibefly.commit?.commitModelSpec ?? empty.commit.commitModelSpec,
            useCustomPrompt: vibefly.commit?.useCustomPrompt ?? empty.commit.useCustomPrompt,
            customPrompt: vibefly.commit?.customPrompt ?? empty.commit.customPrompt,
        },
        modelPreferences: {
            recentModelSpecs: [...(vibefly.modelPreferences?.recentModelSpecs ?? empty.modelPreferences.recentModelSpecs)],
            pinnedModelSpecs: [...(vibefly.modelPreferences?.pinnedModelSpecs ?? empty.modelPreferences.pinnedModelSpecs)],
        },
        ui: {
            locale: vibefly.ui?.locale ?? empty.ui.locale,
        },
    }
}

export type RawSettingsUpdate = {
    settingsJson?: string
    vibeflyJson?: string
}

export type PreparedSettingsSave = RawSettingsUpdate & {
    expectedRevision: string
}

export type SettingsFormPatch = {
    providers?: Partial<ProvidersForm>
    commit?: Partial<CommitForm>
    modelPreferences?: Partial<ModelPreferences>
    ui?: Partial<UiForm>
}

function encode(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`
}

function hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key)
}

function equalValue(left: unknown, right: unknown): boolean {
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((value, index) => value === right[index])
    }
    return left === right
}

function clonePatch(patch: SettingsFormPatch): SettingsFormPatch {
    return mergeSettingsFormPatches({}, patch)
}

export function isEmptySettingsFormPatch(patch: SettingsFormPatch): boolean {
    return !Object.values(patch).some((group) => group && Object.keys(group).length > 0)
}

export function mergeSettingsFormPatches(
    base: SettingsFormPatch,
    update: SettingsFormPatch,
): SettingsFormPatch {
    const merged: SettingsFormPatch = {}
    for (const group of FORM_GROUPS) {
        const values = {...base[group], ...update[group]}
        if (Object.keys(values).length === 0) continue
        if (group === "modelPreferences") {
            const preferences = values as Partial<ModelPreferences>
            merged.modelPreferences = {
                ...preferences,
                ...(preferences.recentModelSpecs
                    ? {recentModelSpecs: [...preferences.recentModelSpecs]}
                    : {}),
                ...(preferences.pinnedModelSpecs
                    ? {pinnedModelSpecs: [...preferences.pinnedModelSpecs]}
                    : {}),
            }
        } else {
            Object.assign(merged, {[group]: values})
        }
    }
    return merged
}

export function diffSettingsForms(before: IdeSettings, after: IdeSettings): SettingsFormPatch {
    const patch: SettingsFormPatch = {}
    for (const key of PROVIDER_KEYS) {
        if (!equalValue(before.providers[key], after.providers[key])) {
            patch.providers = {...patch.providers, [key]: after.providers[key]}
        }
    }
    for (const key of COMMIT_KEYS) {
        if (!equalValue(before.commit[key], after.commit[key])) {
            patch.commit = {...patch.commit, [key]: after.commit[key]}
        }
    }
    for (const key of PREFERENCE_KEYS) {
        if (!equalValue(before.modelPreferences[key], after.modelPreferences[key])) {
            patch.modelPreferences = {
                ...patch.modelPreferences,
                [key]: [...after.modelPreferences[key]],
            }
        }
    }
    if (!equalValue(before.ui.locale, after.ui.locale)) {
        patch.ui = {locale: after.ui.locale}
    }
    return patch
}

export function applySettingsFormPatch(
    settings: IdeSettings,
    patch: SettingsFormPatch,
): IdeSettings {
    let next = settings
    if (patch.providers && Object.keys(patch.providers).length > 0) {
        next = withProviders(next, patch.providers)
    }
    if (patch.commit && Object.keys(patch.commit).length > 0) {
        next = withCommit(next, patch.commit)
    }
    if (patch.modelPreferences && Object.keys(patch.modelPreferences).length > 0) {
        next = withModelPreferences(next, {
            ...patch.modelPreferences,
            ...(patch.modelPreferences.recentModelSpecs
                ? {recentModelSpecs: [...patch.modelPreferences.recentModelSpecs]}
                : {}),
            ...(patch.modelPreferences.pinnedModelSpecs
                ? {pinnedModelSpecs: [...patch.modelPreferences.pinnedModelSpecs]}
                : {}),
        })
    }
    if (patch.ui && Object.keys(patch.ui).length > 0) {
        next = withUi(next, patch.ui)
    }
    return next
}

export function subtractSettingsFormPatch(
    current: SettingsFormPatch,
    saved: SettingsFormPatch,
): SettingsFormPatch {
    const remaining: SettingsFormPatch = {}
    for (const group of FORM_GROUPS) {
        const currentGroup = current[group]
        if (!currentGroup) continue
        const savedGroup = saved[group]
        const values: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(currentGroup)) {
            if (!savedGroup || !hasOwn(savedGroup, key) || !equalValue(value, (savedGroup as Record<string, unknown>)[key])) {
                values[key] = Array.isArray(value) ? [...value] : value
            }
        }
        if (Object.keys(values).length > 0) Object.assign(remaining, {[group]: values})
    }
    return remaining
}

export function updateSettingsFormPatch(
    snapshot: SafeSettingsSnapshot,
    patch: SettingsFormPatch,
): RawSettingsUpdate {
    const update: RawSettingsUpdate = {}
    if (patch.providers && Object.keys(patch.providers).length > 0) {
        let settings = parseJsonObjectDocument(snapshot.settingsJson, "settings.json").value
        if (hasOwn(patch.providers, "defaultProvider")) {
            settings = setJsonAtPath(
                settings,
                ["defaultProvider"],
                patch.providers.defaultProvider?.trim() || null,
            )
        }
        if (hasOwn(patch.providers, "defaultModel")) {
            settings = setJsonAtPath(
                settings,
                ["defaultModel"],
                patch.providers.defaultModel?.trim() || null,
            )
        }
        update.settingsJson = encode(settings)
    }

    const hasVibeflyUpdate = [patch.commit, patch.modelPreferences, patch.ui]
        .some((group) => group && Object.keys(group).length > 0)
    if (hasVibeflyUpdate) {
        let vibefly = parseJsonObjectDocument(snapshot.vibeflyJson, "settings.vibefly.json").value
        for (const [key, value] of Object.entries(patch.commit ?? {})) {
            vibefly = setJsonAtPath(vibefly, ["commit", key], value)
        }
        for (const [key, value] of Object.entries(patch.modelPreferences ?? {})) {
            vibefly = setJsonAtPath(vibefly, ["modelPreferences", key], [...value])
        }
        for (const [key, value] of Object.entries(patch.ui ?? {})) {
            vibefly = setJsonAtPath(vibefly, ["ui", key], value)
        }
        update.vibeflyJson = encode(vibefly)
    }
    return update
}

export function prepareSettingsFormPatchSave(
    manager: SettingsManager<SafeSettingsSnapshot>,
    patch: SettingsFormPatch,
    scope: "application" | "project" = "application",
): PreparedSettingsSave {
    const snapshot = scope === "application"
        ? manager.getSnapshot("application")
        : manager.getSnapshot("project")
    if (!snapshot) throw new Error(`${scope} settings are not loaded`)
    return {
        ...updateSettingsFormPatch(snapshot, clonePatch(patch)),
        expectedRevision: snapshot.revision,
    }
}

export function prepareApplicationFormSave(
    manager: SettingsManager<SafeSettingsSnapshot>,
    form: IdeSettings,
): PreparedSettingsSave {
    return prepareSettingsFormPatchSave(manager, {
        providers: {...form.providers},
        commit: {...form.commit},
        modelPreferences: {
            recentModelSpecs: [...form.modelPreferences.recentModelSpecs],
            pinnedModelSpecs: [...form.modelPreferences.pinnedModelSpecs],
        },
        ui: {...form.ui},
    })
}

export function prepareApplicationModelPreferencesSave(
    manager: SettingsManager<SafeSettingsSnapshot>,
    preferences: ModelPreferences,
): PreparedSettingsSave {
    return prepareSettingsFormPatchSave(manager, {modelPreferences: preferences})
}

export function modelPreferencesFromEffective(effective: EffectiveSettings): ModelPreferences {
    return formFromEffective(effective).modelPreferences
}

export function modelPreferencesFromApplication(
    snapshot: SafeApplicationSettingsSnapshot,
): ModelPreferences {
    const empty = emptySettings().modelPreferences
    const vibefly = parseVibeflySettingsJson(snapshot.vibeflyJson).value
    return {
        recentModelSpecs: [...(vibefly.modelPreferences?.recentModelSpecs ?? empty.recentModelSpecs)],
        pinnedModelSpecs: [...(vibefly.modelPreferences?.pinnedModelSpecs ?? empty.pinnedModelSpecs)],
    }
}

export function applicationSnapshot(
    manager: SettingsManager<SafeSettingsSnapshot>,
): SafeApplicationSettingsSnapshot {
    const snapshot = manager.getSnapshot("application")
    if (!snapshot) throw new Error("Application settings are not loaded")
    return snapshot
}

export function projectSnapshot(
    manager: SettingsManager<SafeSettingsSnapshot>,
): SafeProjectSettingsSnapshot | undefined {
    return manager.getSnapshot("project")
}
