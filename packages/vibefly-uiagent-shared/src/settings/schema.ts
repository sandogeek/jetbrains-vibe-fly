/**
 * 设置域：Pi / Vibe Fly 文档 shape、应用+项目合并、快照缓存与失效协调。
 * JSON 工具见 json.ts；通用 schema 见 json-schema.ts。本文件再导出二者以保持原有导入路径。
 */
import {cloneJsonValue, deepMergeJsonObjects, type JsonObject,} from "../json.js"
import {
    arrayRule,
    BOOLEAN_RULE,
    enumRule,
    type InferRule,
    NON_NEGATIVE_NUMBER_RULE,
    objectRule,
    optional,
    parseAndValidateObject,
    parseJsonObject,
    required,
    type SchemaDiagnostic,
    type SchemaObject,
    type SchemaShape,
    type SchemaValidationResult,
    type StrictObject,
    strictObjectRule,
    type StrictShape,
    STRING_ARRAY_RULE,
    STRING_ARRAY_VALUE_RULE,
    STRING_RULE,
    unionRule,
    valueRule,
} from "../json-schema.js"

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

export type SettingsDiagnostic = {
    file: SettingsFileName
    severity: "error" | "warning"
    message: string
}

export type SettingsChanged = {
    scope: SettingsScope
    projectRoot: string | null
    revision: string
}

type SafeSettingsSnapshotFields = {
    settingsJson: string
    vibeflyJson: string
    revision: string
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

// --- Pi settings.json ---

const PI_PACKAGE_SETTINGS_SHAPE = {
    source: required(STRING_RULE),
    autoload: optional(BOOLEAN_RULE),
    extensions: optional(STRING_ARRAY_VALUE_RULE),
    skills: optional(STRING_ARRAY_VALUE_RULE),
    prompts: optional(STRING_ARRAY_VALUE_RULE),
    themes: optional(STRING_ARRAY_VALUE_RULE),
} satisfies StrictShape

export type PiPackageSettings = StrictObject<typeof PI_PACKAGE_SETTINGS_SHAPE>

const PACKAGE_SOURCE_OBJECT_RULE = strictObjectRule(
    PI_PACKAGE_SETTINGS_SHAPE,
    "a package source object",
)
const PACKAGE_SOURCE_RULE = unionRule(
    [STRING_RULE, PACKAGE_SOURCE_OBJECT_RULE] as const,
    "a string or package source object",
)

export type PiPackageSource = InferRule<typeof PACKAGE_SOURCE_RULE>

const PI_RETRY_PROVIDER_RULE = objectRule({
    timeoutMs: NON_NEGATIVE_NUMBER_RULE,
    maxRetries: NON_NEGATIVE_NUMBER_RULE,
    maxRetryDelayMs: NON_NEGATIVE_NUMBER_RULE,
})

const PI_RETRY_RULE = objectRule({
    enabled: BOOLEAN_RULE,
    maxRetries: NON_NEGATIVE_NUMBER_RULE,
    baseDelayMs: NON_NEGATIVE_NUMBER_RULE,
    provider: PI_RETRY_PROVIDER_RULE,
})

const PI_COMPACTION_RULE = objectRule({
    enabled: BOOLEAN_RULE,
    reserveTokens: NON_NEGATIVE_NUMBER_RULE,
    keepRecentTokens: NON_NEGATIVE_NUMBER_RULE,
})

const PI_BRANCH_SUMMARY_RULE = objectRule({
    reserveTokens: NON_NEGATIVE_NUMBER_RULE,
    skipPrompt: BOOLEAN_RULE,
})

const PI_TERMINAL_RULE = objectRule({
    showImages: BOOLEAN_RULE,
    imageWidthCells: NON_NEGATIVE_NUMBER_RULE,
    clearOnShrink: BOOLEAN_RULE,
    showTerminalProgress: BOOLEAN_RULE,
})

const PI_IMAGE_RULE = objectRule({
    autoResize: BOOLEAN_RULE,
    blockImages: BOOLEAN_RULE,
})

const PI_THINKING_BUDGETS_RULE = objectRule({
    minimal: NON_NEGATIVE_NUMBER_RULE,
    low: NON_NEGATIVE_NUMBER_RULE,
    medium: NON_NEGATIVE_NUMBER_RULE,
    high: NON_NEGATIVE_NUMBER_RULE,
})

const PI_MARKDOWN_RULE = objectRule({
    codeBlockIndent: STRING_RULE,
})

const PI_WARNING_RULE = objectRule({
    anthropicExtraUsage: BOOLEAN_RULE,
})

// 非法 package 项过滤掉，避免一条坏配置拖垮整个列表
const PACKAGE_SOURCES_RULE = arrayRule(
    PACKAGE_SOURCE_RULE,
    "an array of package sources",
    "filter",
)
const OUTPUT_PAD_RULE = valueRule<0 | 1>(
    "0 or 1",
    (value): value is 0 | 1 => value === 0 || value === 1,
)
const THINKING_LEVEL_RULE = enumRule(
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const,
    "a supported thinking level",
)
const TRANSPORT_RULE = enumRule(
    ["auto", "sse", "websocket", "websocket-cached"] as const,
    "auto, sse, websocket, or websocket-cached",
)
const QUEUE_MODE_RULE = enumRule(
    ["all", "one-at-a-time"] as const,
    "a supported queue mode",
)
const PROJECT_TRUST_RULE = enumRule(
    ["ask", "always", "never"] as const,
    "ask, always, or never",
)
const DOUBLE_ESCAPE_ACTION_RULE = enumRule(
    ["fork", "tree", "none"] as const,
    "fork, tree, or none",
)
const TREE_FILTER_MODE_RULE = enumRule(
    ["default", "no-tools", "user-only", "labeled-only", "all"] as const,
    "a supported tree filter mode",
)

const PI_SETTINGS_SHAPE = {
    lastChangelogVersion: STRING_RULE,
    defaultProvider: STRING_RULE,
    defaultModel: STRING_RULE,
    theme: STRING_RULE,
    externalEditor: STRING_RULE,
    shellPath: STRING_RULE,
    shellCommandPrefix: STRING_RULE,
    trackingId: STRING_RULE,
    sessionDir: STRING_RULE,
    httpProxy: STRING_RULE,
    hideThinkingBlock: BOOLEAN_RULE,
    showCacheMissNotices: BOOLEAN_RULE,
    quietStartup: BOOLEAN_RULE,
    collapseChangelog: BOOLEAN_RULE,
    enableInstallTelemetry: BOOLEAN_RULE,
    enableAnalytics: BOOLEAN_RULE,
    enableSkillCommands: BOOLEAN_RULE,
    showHardwareCursor: BOOLEAN_RULE,
    editorPaddingX: NON_NEGATIVE_NUMBER_RULE,
    autocompleteMaxVisible: NON_NEGATIVE_NUMBER_RULE,
    httpIdleTimeoutMs: NON_NEGATIVE_NUMBER_RULE,
    websocketConnectTimeoutMs: NON_NEGATIVE_NUMBER_RULE,
    extensions: STRING_ARRAY_RULE,
    skills: STRING_ARRAY_RULE,
    prompts: STRING_ARRAY_RULE,
    themes: STRING_ARRAY_RULE,
    npmCommand: STRING_ARRAY_RULE,
    enabledModels: STRING_ARRAY_RULE,
    defaultThinkingLevel: THINKING_LEVEL_RULE,
    transport: TRANSPORT_RULE,
    steeringMode: QUEUE_MODE_RULE,
    followUpMode: QUEUE_MODE_RULE,
    defaultProjectTrust: PROJECT_TRUST_RULE,
    doubleEscapeAction: DOUBLE_ESCAPE_ACTION_RULE,
    treeFilterMode: TREE_FILTER_MODE_RULE,
    packages: PACKAGE_SOURCES_RULE,
    outputPad: OUTPUT_PAD_RULE,
    compaction: PI_COMPACTION_RULE,
    branchSummary: PI_BRANCH_SUMMARY_RULE,
    retry: PI_RETRY_RULE,
    terminal: PI_TERMINAL_RULE,
    images: PI_IMAGE_RULE,
    thinkingBudgets: PI_THINKING_BUDGETS_RULE,
    markdown: PI_MARKDOWN_RULE,
    warnings: PI_WARNING_RULE,
} satisfies SchemaShape

// --- settings.vibefly.json ---

const LOCALE_MODE_RULE = enumRule(
    ["follow_ide", "en", "zh"] as const,
    "follow_ide, en, or zh",
)

const VIBEFLY_COMMIT_RULE = objectRule({
    languageMode: LOCALE_MODE_RULE,
    commitModelSpec: STRING_RULE,
    useCustomPrompt: BOOLEAN_RULE,
    customPrompt: STRING_RULE,
})

const VIBEFLY_MODEL_PREFERENCES_RULE = objectRule({
    recentModelSpecs: STRING_ARRAY_RULE,
    pinnedModelSpecs: STRING_ARRAY_RULE,
})

const VIBEFLY_UI_RULE = objectRule({
    locale: LOCALE_MODE_RULE,
})

const VIBEFLY_SETTINGS_SHAPE = {
    commit: VIBEFLY_COMMIT_RULE,
    modelPreferences: VIBEFLY_MODEL_PREFERENCES_RULE,
    ui: VIBEFLY_UI_RULE,
} satisfies SchemaShape

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
    revision: string
    applicationRevision: string
    projectRevision: string | null
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
    applicationRevision: string,
    projectRevision: string | null,
): string {
    return JSON.stringify([applicationRevision, projectRevision])
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
        applicationRevision: application.revision,
        projectRevision: project?.revision ?? null,
        revision: createEffectiveRevision(application.revision, project?.revision ?? null),
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
