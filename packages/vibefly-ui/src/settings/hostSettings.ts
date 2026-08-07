import {
    type EffectiveSettings,
    parseJsonObjectDocument,
    type SafeApplicationSettingsSnapshot,
    type SafeProjectSettingsSnapshot,
    type SafeSettingsSnapshot,
    setJsonAtPath,
    type SettingsChanged,
    type SettingsDiagnostic,
    SettingsManager,
} from "@vibefly/uiagent-shared"
import type {Ui2Host, UiSettingsSnapshot} from "../generated/rpc"
import type {CommitForm, IdeSettings, ModelPreferences, ProvidersForm, UiForm,} from "./settingsStore"

const FILE_NAMES = new Set([
    "settings.json",
    "settings.vibefly.json",
    "models.json",
    "auth.json",
])
type SafeValueKind = "string" | "boolean" | "stringArray"

const SAFE_SETTINGS_KEYS: ReadonlyMap<string, SafeValueKind> = new Map([
    ["defaultProvider", "string"],
    ["defaultModel", "string"],
] as const)
const SAFE_VIBEFLY_KEYS: ReadonlyMap<string, ReadonlyMap<string, SafeValueKind>> =
    new Map<string, ReadonlyMap<string, SafeValueKind>>([
        ["commit", new Map<string, SafeValueKind>([
            ["languageMode", "string"],
            ["commitModelSpec", "string"],
            ["useCustomPrompt", "boolean"],
            ["customPrompt", "string"],
        ] as const)],
        ["modelPreferences", new Map<string, SafeValueKind>([
            ["recentModelSpecs", "stringArray"],
            ["pinnedModelSpecs", "stringArray"],
        ] as const)],
        ["ui", new Map<string, SafeValueKind>([["locale", "string"]])],
    ] as const)

function isSafeValue(value: unknown, kind: SafeValueKind): boolean {
    if (value === null) return true
    if (kind === "string") return typeof value === "string"
    if (kind === "boolean") return typeof value === "boolean"
    return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function safeJsonProjection(raw: unknown, vibefly: boolean): string {
    let parsed: unknown
    try {
        parsed = JSON.parse(String(raw ?? "{}"))
    } catch {
        return "{}"
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "{}"
    const source = parsed as Record<string, unknown>
    const projected: Record<string, unknown> = {}
    if (!vibefly) {
        for (const [key, kind] of SAFE_SETTINGS_KEYS) {
            if (hasOwn(source, key) && isSafeValue(source[key], kind)) projected[key] = source[key]
        }
    } else {
        for (const [group, fields] of SAFE_VIBEFLY_KEYS) {
            const rawGroup = source[group]
            if (rawGroup === null) {
                projected[group] = null
                continue
            }
            if (!rawGroup || typeof rawGroup !== "object" || Array.isArray(rawGroup)) continue
            const values: Record<string, unknown> = {}
            for (const [key, kind] of fields) {
                const value = (rawGroup as Record<string, unknown>)[key]
                if (hasOwn(rawGroup, key) && isSafeValue(value, kind)) values[key] = value
            }
            projected[group] = values
        }
    }
    return JSON.stringify(projected)
}

function safeDiagnostics(raw: UiSettingsSnapshot["diagnostics"]): SettingsDiagnostic[] {
    const diagnostics: SettingsDiagnostic[] = []
    for (const item of raw ?? []) {
        if (!FILE_NAMES.has(item.file)) continue
        if (item.severity !== "error" && item.severity !== "warning") continue
        diagnostics.push({
            file: item.file as SettingsDiagnostic["file"],
            severity: item.severity,
            message: String(item.message),
        })
    }
    return diagnostics
}

/** Copy only fields that are safe to retain in the WebView. */
export function safeUiSettingsSnapshot(raw: UiSettingsSnapshot): SafeSettingsSnapshot {
    const common = {
        settingsJson: safeJsonProjection(raw.settingsJson, false),
        vibeflyJson: safeJsonProjection(raw.vibeflyJson, true),
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

export function formFromEffective(effective: EffectiveSettings): IdeSettings {
    const preferences = effective.vibefly.modelPreferences
    const commit = effective.vibefly.commit
    const ui = effective.vibefly.ui
    return {
        providers: {
            defaultProvider: typeof effective.settings.defaultProvider === "string"
                ? effective.settings.defaultProvider
                : "",
            defaultModel: typeof effective.settings.defaultModel === "string"
                ? effective.settings.defaultModel
                : "",
        },
        commit: {
            languageMode: commit?.languageMode ?? "follow_ide",
            commitModelSpec: typeof commit?.commitModelSpec === "string" ? commit.commitModelSpec : "",
            useCustomPrompt: Boolean(commit?.useCustomPrompt),
            customPrompt: typeof commit?.customPrompt === "string" ? commit.customPrompt : "",
        },
        modelPreferences: {
            recentModelSpecs: [...(preferences?.recentModelSpecs ?? [])],
            pinnedModelSpecs: [...(preferences?.pinnedModelSpecs ?? [])],
        },
        ui: {locale: ui?.locale ?? "follow_ide"},
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
    for (const group of ["providers", "commit", "modelPreferences", "ui"] as const) {
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
    for (const key of ["defaultProvider", "defaultModel"] as const) {
        if (!equalValue(before.providers[key], after.providers[key])) {
            patch.providers = {...patch.providers, [key]: after.providers[key]}
        }
    }
    for (const key of ["languageMode", "commitModelSpec", "useCustomPrompt", "customPrompt"] as const) {
        if (!equalValue(before.commit[key], after.commit[key])) {
            patch.commit = {...patch.commit, [key]: after.commit[key]}
        }
    }
    for (const key of ["recentModelSpecs", "pinnedModelSpecs"] as const) {
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
    return {
        providers: {...settings.providers, ...patch.providers},
        commit: {...settings.commit, ...patch.commit},
        modelPreferences: {
            ...settings.modelPreferences,
            ...patch.modelPreferences,
            ...(patch.modelPreferences?.recentModelSpecs
                ? {recentModelSpecs: [...patch.modelPreferences.recentModelSpecs]}
                : {}),
            ...(patch.modelPreferences?.pinnedModelSpecs
                ? {pinnedModelSpecs: [...patch.modelPreferences.pinnedModelSpecs]}
                : {}),
        },
        ui: {...settings.ui, ...patch.ui},
    }
}

export function subtractSettingsFormPatch(
    current: SettingsFormPatch,
    saved: SettingsFormPatch,
): SettingsFormPatch {
    const remaining: SettingsFormPatch = {}
    for (const group of ["providers", "commit", "modelPreferences", "ui"] as const) {
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
    const value = effective.vibefly.modelPreferences
    return {
        recentModelSpecs: Array.isArray(value?.recentModelSpecs)
            ? value.recentModelSpecs.filter((item): item is string => typeof item === "string")
            : [],
        pinnedModelSpecs: Array.isArray(value?.pinnedModelSpecs)
            ? value.pinnedModelSpecs.filter((item): item is string => typeof item === "string")
            : [],
    }
}

export function modelPreferencesFromApplication(
    snapshot: SafeApplicationSettingsSnapshot,
): ModelPreferences {
    const parsed = parseJsonObjectDocument(snapshot.vibeflyJson, "settings.vibefly.json").value
    return modelPreferencesFromEffective({
        settings: {},
        vibefly: parsed,
        revision: snapshot.revision,
        applicationRevision: snapshot.revision,
        projectRevision: null,
        diagnostics: [],
    })
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
