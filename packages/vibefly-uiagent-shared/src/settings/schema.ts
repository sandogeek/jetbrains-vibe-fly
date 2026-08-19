/**
 * 设置域：解析 / 类型推断 / effective merge、快照缓存与失效协调。
 * 文档 shape 与 managed-field 元数据见 definition.ts。
 * JSON 工具见 json.ts；通用 schema 见 json-schema.ts。本文件再导出二者以保持原有导入路径。
 */
import {cloneJsonValue, deepMergeJsonObjects, type JsonObject,} from "../json.js"
import {
    type InferRule,
    parseAndValidateObject,
    parseJsonObject,
    type SchemaDiagnostic,
    type SchemaObject,
    type SchemaValidationResult,
    type StrictObject,
} from "../json-schema.js"
import {
    PACKAGE_SOURCE_RULE,
    PI_BRANCH_SUMMARY_RULE,
    PI_COMPACTION_RULE,
    PI_IMAGE_RULE,
    PI_MARKDOWN_RULE,
    PI_PACKAGE_SETTINGS_SHAPE,
    PI_RETRY_PROVIDER_RULE,
    PI_RETRY_RULE,
    PI_SETTINGS_SHAPE,
    PI_TERMINAL_RULE,
    PI_THINKING_BUDGETS_RULE,
    PI_WARNING_RULE,
    VIBEFLY_COMMIT_RULE,
    VIBEFLY_MODEL_PREFERENCES_RULE,
    VIBEFLY_SETTINGS_SHAPE,
    VIBEFLY_UI_RULE,
} from "./definition.js"

export type {
    JsonObject,
    JsonPrimitive,
    JsonValue,
} from "../json.js"
export {
    cloneJsonValue,
    deepMergeJsonObjects,
    isJsonObject,
    setJsonAtPath,
    updateJsonAtPath,
} from "../json.js"
export type {
    ArrayRule,
    InferRule,
    ObjectRule,
    SchemaDiagnostic,
    SchemaObject,
    SchemaRule,
    SchemaShape,
    SchemaValidationResult,
    StrictField,
    StrictObject,
    StrictObjectRule,
    StrictShape,
    UnionRule,
    ValueRule,
} from "../json-schema.js"
export {
    arrayRule,
    BOOLEAN_RULE,
    booleanValue,
    enumRule,
    matchesRule,
    matchesStrictObject,
    NON_NEGATIVE_NUMBER_RULE,
    numberValue,
    objectRule,
    optional,
    parseJsonObject,
    required,
    STRING_ARRAY_RULE,
    STRING_ARRAY_VALUE_RULE,
    STRING_RULE,
    stringArray,
    stringValue,
    strictObjectRule,
    unionRule,
    parseAndValidateObject,
    validateObject,
    validateRule,
    valueRule,
} from "../json-schema.js"

export type SettingsScope = "application" | "project"

export type SettingsFileName =
    | "settings.json"
    | "settings.vibefly.json"
    | "models.json"
    | "auth.json"

export type SettingsFileRevisions = Partial<Record<SettingsFileName, string>>

export type SettingsDiagnostic = {
    file: SettingsFileName
    severity: "error" | "warning"
    message: string
}

type SafeSettingsSnapshotFields = {
    settingsJson: string
    vibeflyJson: string
    revisions: SettingsFileRevisions
    diagnostics: SettingsDiagnostic[]
}

export type SafeApplicationSettingsSnapshot = SafeSettingsSnapshotFields & {
    scope: "application"
    projectRoot: null
}

export type SafeProjectSettingsSnapshot = SafeSettingsSnapshotFields & {
    scope: "project"
    projectRoot: string
}

/** 浏览器安全快照：仅含 JSON 文本，不含原始凭据。 */
export type SafeSettingsSnapshot =
    | SafeApplicationSettingsSnapshot
    | SafeProjectSettingsSnapshot

export type SettingsValidationResult<T extends JsonObject> = {
    value: T
    diagnostics: SettingsDiagnostic[]
}

/** 按出现顺序去重合并诊断 */
export function aggregateSettingsDiagnostics(
    ...groups: Array<readonly SettingsDiagnostic[] | undefined>
): SettingsDiagnostic[] {
    const result: SettingsDiagnostic[] = []
    const seen = new Set<string>()
    for (const group of groups) {
        for (const diagnostic of group ?? []) {
            const key = JSON.stringify([
                diagnostic.file,
                diagnostic.severity,
                diagnostic.message,
            ])
            if (seen.has(key)) continue
            seen.add(key)
            result.push({...diagnostic})
        }
    }
    return result
}

/** 通用 schema 诊断挂上具体设置文件名 */
function attachFile(
    file: SettingsFileName,
    diagnostics: readonly SchemaDiagnostic[],
): SettingsDiagnostic[] {
    return diagnostics.map((diagnostic) => ({...diagnostic, file}))
}

function toSettingsResult<T extends JsonObject>(
    file: SettingsFileName,
    result: SchemaValidationResult<T>,
): SettingsValidationResult<T> {
    return {
        value: result.value,
        diagnostics: attachFile(file, result.diagnostics),
    }
}

export function parseJsonObjectDocument(
    source: string,
    file: SettingsFileName,
): SettingsValidationResult<JsonObject> {
    return toSettingsResult(file, parseJsonObject(source))
}

export type PiPackageSettings = StrictObject<typeof PI_PACKAGE_SETTINGS_SHAPE>
export type PiPackageSource = InferRule<typeof PACKAGE_SOURCE_RULE>
export type PiCompactionSettings = InferRule<typeof PI_COMPACTION_RULE>
export type PiRetryProviderSettings = InferRule<typeof PI_RETRY_PROVIDER_RULE>
export type PiRetrySettings = InferRule<typeof PI_RETRY_RULE>
export type PiBranchSummarySettings = InferRule<typeof PI_BRANCH_SUMMARY_RULE>
export type PiTerminalSettings = InferRule<typeof PI_TERMINAL_RULE>
export type PiImageSettings = InferRule<typeof PI_IMAGE_RULE>
export type PiThinkingBudgetsSettings = InferRule<typeof PI_THINKING_BUDGETS_RULE>
export type PiMarkdownSettings = InferRule<typeof PI_MARKDOWN_RULE>
export type PiWarningSettings = InferRule<typeof PI_WARNING_RULE>
export type PiSettings = SchemaObject<typeof PI_SETTINGS_SHAPE>

export type VibeflyCommitSettings = InferRule<typeof VIBEFLY_COMMIT_RULE>
export type VibeflyModelPreferences = InferRule<typeof VIBEFLY_MODEL_PREFERENCES_RULE>
export type VibeflyUiSettings = InferRule<typeof VIBEFLY_UI_RULE>
export type VibeflySettings = SchemaObject<typeof VIBEFLY_SETTINGS_SHAPE>

export type EffectiveSettings = {
    settings: PiSettings
    vibefly: VibeflySettings
    revisions: {
        application: SettingsFileRevisions
        project: SettingsFileRevisions | null
    }
    diagnostics: SettingsDiagnostic[]
}

export function parsePiSettingsJson(source: string): SettingsValidationResult<PiSettings> {
    return toSettingsResult("settings.json", parseAndValidateObject(source, PI_SETTINGS_SHAPE))
}

export function parseVibeflySettingsJson(
    source: string,
): SettingsValidationResult<VibeflySettings> {
    return toSettingsResult(
        "settings.vibefly.json",
        parseAndValidateObject(source, VIBEFLY_SETTINGS_SHAPE),
    )
}

export function createEffectiveRevision(
    applicationRevisions: SettingsFileRevisions,
    projectRevisions: SettingsFileRevisions | null,
): string {
    return JSON.stringify([applicationRevisions, projectRevisions])
}

/** application 为底，project 覆盖；诊断来自两侧快照与解析结果 */
export function computeEffectiveSettings(
    application: SafeApplicationSettingsSnapshot,
    project?: SafeProjectSettingsSnapshot,
): EffectiveSettings {
    assertSnapshotScope(application, "application")
    if (project) assertSnapshotScope(project, "project")

    const applicationSettings = parsePiSettingsJson(application.settingsJson)
    const applicationVibefly = parseVibeflySettingsJson(application.vibeflyJson)
    const projectSettings = project ? parsePiSettingsJson(project.settingsJson) : undefined
    const projectVibefly = project ? parseVibeflySettingsJson(project.vibeflyJson) : undefined
    const settings = projectSettings
        ? deepMergeJsonObjects(applicationSettings.value, projectSettings.value) as PiSettings
        : cloneJsonValue(applicationSettings.value)
    const vibefly = projectVibefly
        ? deepMergeJsonObjects(applicationVibefly.value, projectVibefly.value) as VibeflySettings
        : cloneJsonValue(applicationVibefly.value)

    return {
        settings,
        vibefly,
        revisions: {
            application: {...application.revisions},
            project: project ? {...project.revisions} : null,
        },
        diagnostics: aggregateSettingsDiagnostics(
            application.diagnostics,
            project?.diagnostics,
            applicationSettings.diagnostics,
            projectSettings?.diagnostics,
            applicationVibefly.diagnostics,
            projectVibefly?.diagnostics,
        ),
    }
}

function assertSnapshotScope(
    snapshot: SafeSettingsSnapshot,
    expected: SettingsScope,
): void {
    if (snapshot.scope !== expected) {
        throw new Error(`Expected ${expected} settings snapshot, received ${snapshot.scope}`)
    }
    if (snapshot.scope === "application" && snapshot.projectRoot !== null) {
        throw new Error("Application settings snapshot must have a null projectRoot")
    }
    if (snapshot.scope === "project" && !snapshot.projectRoot.trim()) {
        throw new Error("Project settings snapshot must have a projectRoot")
    }
}
