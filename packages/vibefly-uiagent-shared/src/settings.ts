export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export type JsonObject = {
    [key: string]: JsonValue
}

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

/** Browser-safe snapshot shape. It intentionally has no raw credential field. */
export type SafeSettingsSnapshot =
    | SafeApplicationSettingsSnapshot
    | SafeProjectSettingsSnapshot

export type SettingsValidationResult<T extends JsonObject> = {
    value: T
    diagnostics: SettingsDiagnostic[]
}

function hasOwn(object: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(object, key)
}

function defineValue(object: JsonObject, key: string, value: JsonValue): void {
    Object.defineProperty(object, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
    })
}

export function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function cloneJsonValue<T extends JsonValue>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => cloneJsonValue(item)) as T
    }
    if (!isJsonObject(value)) return value
    const clone: JsonObject = {}
    for (const [key, child] of Object.entries(value)) {
        defineValue(clone, key, cloneJsonValue(child))
    }
    return clone as T
}

/**
 * Recursively merge JSON objects. Arrays, scalar values, and null are replaced
 * as a whole by the override layer.
 */
export function deepMergeJsonObjects(base: JsonObject, override: JsonObject): JsonObject {
    const merged = cloneJsonValue(base)
    for (const [key, overrideValue] of Object.entries(override)) {
        const baseValue = hasOwn(base, key) ? base[key] : undefined
        const next = isJsonObject(baseValue) && isJsonObject(overrideValue)
            ? deepMergeJsonObjects(baseValue, overrideValue)
            : cloneJsonValue(overrideValue)
        defineValue(merged, key, next)
    }
    return merged
}

export function updateJsonAtPath(
    source: JsonObject,
    path: readonly string[],
    updater: (current: JsonValue | undefined) => JsonValue | undefined,
): JsonObject {
    if (path.length === 0) throw new Error("JSON update path must not be empty")

    const updateObject = (current: JsonObject, index: number): JsonObject => {
        const output = cloneJsonValue(current)
        const key = path[index]!
        if (index === path.length - 1) {
            const next = updater(hasOwn(current, key) ? cloneJsonValue(current[key]!) : undefined)
            if (next === undefined) delete output[key]
            else defineValue(output, key, cloneJsonValue(next))
            return output
        }

        const child = hasOwn(current, key) && isJsonObject(current[key])
            ? current[key] as JsonObject
            : {}
        defineValue(output, key, updateObject(child, index + 1))
        return output
    }

    return updateObject(source, 0)
}

export function setJsonAtPath(
    source: JsonObject,
    path: readonly string[],
    value: JsonValue | undefined,
): JsonObject {
    return updateJsonAtPath(source, path, () => value)
}

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

export function parseJsonObjectDocument(
    source: string,
    file: SettingsFileName,
): SettingsValidationResult<JsonObject> {
    let parsed: unknown
    try {
        parsed = JSON.parse(source)
    } catch (error) {
        const detail = error instanceof Error ? error.message : "invalid JSON"
        return {
            value: {},
            diagnostics: [{file, severity: "error", message: `Invalid JSON: ${detail}`}],
        }
    }
    if (!isJsonObject(parsed)) {
        return {
            value: {},
            diagnostics: [{file, severity: "error", message: "Document root must be an object"}],
        }
    }
    return {value: cloneJsonValue(parsed), diagnostics: []}
}

type ValueRule<TValue extends JsonValue = JsonValue> = {
    kind: "value"
    expected: string
    test: (value: JsonValue) => value is TValue
}

interface ArrayRule<TItemRule extends SettingsRule = SettingsRule> {
    kind: "array"
    expected: string
    item: TItemRule
    invalidItems: "reject" | "filter"
}

interface ObjectRule<TShape extends SettingsShape = SettingsShape> {
    kind: "object"
    expected: "an object"
    shape: TShape
}

interface StrictObjectRule<TShape extends StrictShape = StrictShape> {
    kind: "strict-object"
    expected: string
    shape: TShape
}

interface UnionRule<TRules extends readonly SettingsRule[] = readonly SettingsRule[]> {
    kind: "union"
    expected: string
    rules: TRules
}

interface SettingsShape {
    [key: string]: SettingsRule
}

type SettingsRule = ValueRule | ArrayRule | ObjectRule | StrictObjectRule | UnionRule

type InferRule<TRule extends SettingsRule> =
    TRule extends ValueRule<infer TValue>
        ? TValue
        : TRule extends ObjectRule<infer TShape>
            ? SettingsObject<TShape>
            : TRule extends StrictObjectRule<infer TShape>
                ? StrictObject<TShape>
                : TRule extends ArrayRule<infer TItemRule>
                    ? InferRule<TItemRule>[]
                    : TRule extends UnionRule<infer TRules>
                        ? InferRule<TRules[number]>
                        : never

type SettingsObject<TShape extends SettingsShape> = JsonObject & {
    [TKey in keyof TShape]?: InferRule<TShape[TKey]> | null
}

type StrictField<TRule extends ValueRule = ValueRule> = {
    required: boolean
    rule: TRule
}

type StrictShape = Record<string, StrictField>

type RequiredStrictKey<TShape extends StrictShape> = {
    [TKey in keyof TShape]-?: TShape[TKey]["required"] extends true
        ? TKey
        : never
}[keyof TShape]

type StrictObject<TShape extends StrictShape> = JsonObject & {
    [TKey in RequiredStrictKey<TShape>]: InferRule<TShape[TKey]["rule"]>
} & {
    [TKey in Exclude<keyof TShape, RequiredStrictKey<TShape>>]?: InferRule<TShape[TKey]["rule"]>
}

function valueRule<TValue extends JsonValue>(
    expected: string,
    test: (value: JsonValue) => value is TValue,
): ValueRule<TValue> {
    return {kind: "value", expected, test}
}

function objectRule<const TShape extends SettingsShape>(
    shape: TShape,
): ObjectRule<TShape> {
    return {kind: "object", expected: "an object", shape}
}

function strictObjectRule<const TShape extends StrictShape>(
    shape: TShape,
    expected: string,
): StrictObjectRule<TShape> {
    return {kind: "strict-object", expected, shape}
}

function arrayRule<const TItemRule extends SettingsRule>(
    item: TItemRule,
    expected: string,
    invalidItems: "reject" | "filter" = "reject",
): ArrayRule<TItemRule> {
    return {kind: "array", expected, item, invalidItems}
}

function unionRule<const TRules extends readonly SettingsRule[]>(
    rules: TRules,
    expected: string,
): UnionRule<TRules> {
    return {kind: "union", expected, rules}
}

function required<const TRule extends ValueRule>(rule: TRule): {
    required: true
    rule: TRule
} {
    return {required: true, rule}
}

function optional<const TRule extends ValueRule>(rule: TRule): {
    required: false
    rule: TRule
} {
    return {required: false, rule}
}

function stringValue(value: JsonValue): value is string {
    return typeof value === "string"
}

function booleanValue(value: JsonValue): value is boolean {
    return typeof value === "boolean"
}

function numberValue(value: JsonValue): value is number {
    return typeof value === "number" && Number.isFinite(value)
}

function nonNegativeNumber(value: JsonValue): value is number {
    return numberValue(value) && value >= 0
}

function stringArray(value: JsonValue): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function enumRule<const TValues extends readonly string[]>(
    values: TValues,
    expected: string,
): ValueRule<TValues[number]> {
    const supported = new Set<string>(values)
    return valueRule(
        expected,
        (value): value is TValues[number] => typeof value === "string" && supported.has(value),
    )
}

const STRING_RULE = valueRule("a string", stringValue)
const BOOLEAN_RULE = valueRule("a boolean", booleanValue)
const NON_NEGATIVE_NUMBER_RULE = valueRule("a non-negative number", nonNegativeNumber)
const STRING_ARRAY_VALUE_RULE = valueRule("an array of strings", stringArray)
const STRING_ARRAY_RULE = arrayRule(STRING_RULE, "an array of strings")

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

function matchesStrictObject<TShape extends StrictShape>(
    value: JsonValue,
    shape: TShape,
): value is StrictObject<TShape> {
    if (!isJsonObject(value)) return false
    for (const [key, field] of Object.entries(shape)) {
        if (!hasOwn(value, key)) {
            if (field.required) return false
            continue
        }
        if (!field.rule.test(value[key]!)) return false
    }
    return true
}

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
} satisfies SettingsShape

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
} satisfies SettingsShape

export type PiCompactionSettings = InferRule<typeof PI_COMPACTION_RULE>
export type PiRetryProviderSettings = InferRule<typeof PI_RETRY_PROVIDER_RULE>
export type PiRetrySettings = InferRule<typeof PI_RETRY_RULE>
export type PiBranchSummarySettings = InferRule<typeof PI_BRANCH_SUMMARY_RULE>
export type PiTerminalSettings = InferRule<typeof PI_TERMINAL_RULE>
export type PiImageSettings = InferRule<typeof PI_IMAGE_RULE>
export type PiThinkingBudgetsSettings = InferRule<typeof PI_THINKING_BUDGETS_RULE>
export type PiMarkdownSettings = InferRule<typeof PI_MARKDOWN_RULE>
export type PiWarningSettings = InferRule<typeof PI_WARNING_RULE>
export type PiSettings = SettingsObject<typeof PI_SETTINGS_SHAPE>

export type VibeflyCommitSettings = InferRule<typeof VIBEFLY_COMMIT_RULE>
export type VibeflyModelPreferences = InferRule<typeof VIBEFLY_MODEL_PREFERENCES_RULE>
export type VibeflyUiSettings = InferRule<typeof VIBEFLY_UI_RULE>
export type VibeflySettings = SettingsObject<typeof VIBEFLY_SETTINGS_SHAPE>

export type EffectiveSettings = {
    settings: PiSettings
    vibefly: VibeflySettings
    revision: string
    applicationRevision: string
    projectRevision: string | null
    diagnostics: SettingsDiagnostic[]
}

function matchesRule(value: JsonValue, rule: SettingsRule): boolean {
    switch (rule.kind) {
        case "value":
            return rule.test(value)
        case "object":
            if (!isJsonObject(value)) return false
            return Object.entries(rule.shape).every(([key, childRule]) => {
                return !hasOwn(value, key) || value[key] === null || matchesRule(value[key]!, childRule)
            })
        case "strict-object":
            return matchesStrictObject(value, rule.shape)
        case "array":
            return Array.isArray(value) && value.every((item) => matchesRule(item, rule.item))
        case "union":
            return rule.rules.some((candidate) => matchesRule(value, candidate))
    }
}

function validateRule(
    value: JsonValue,
    rule: SettingsRule,
    file: SettingsFileName,
    path: string,
    diagnostics: SettingsDiagnostic[],
): boolean {
    switch (rule.kind) {
        case "value":
            return rule.test(value)
        case "object":
            if (!isJsonObject(value)) return false
            validateSettingsObject(value, rule.shape, file, path, diagnostics)
            return true
        case "strict-object":
            return matchesStrictObject(value, rule.shape)
        case "union":
            return matchesRule(value, rule)
        case "array":
            if (!Array.isArray(value)) return false
            if (rule.invalidItems === "reject") {
                return value.every((item) => matchesRule(item, rule.item))
            }

            const validItems: JsonValue[] = []
            for (const [index, item] of value.entries()) {
                if (matchesRule(item, rule.item)) {
                    validItems.push(item)
                    continue
                }
                diagnostics.push({
                    file,
                    severity: "error",
                    message: `${path}[${index}] must be ${rule.item.expected}`,
                })
            }
            value.splice(0, value.length, ...validItems)
            return true
    }
}

function validateSettingsObject<TShape extends SettingsShape>(
    value: JsonObject,
    shape: TShape,
    file: SettingsFileName,
    path: string,
    diagnostics: SettingsDiagnostic[],
): SettingsObject<TShape> {
    for (const [key, rule] of Object.entries(shape)) {
        if (!hasOwn(value, key) || value[key] === null) continue
        const child = value[key]!
        if (validateRule(child, rule, file, `${path}.${key}`, diagnostics)) continue

        delete value[key]
        diagnostics.push({
            file,
            severity: "error",
            message: `${path}.${key} must be ${rule.expected}`,
        })
    }
    return value as SettingsObject<TShape>
}

export function parsePiSettingsJson(source: string): SettingsValidationResult<PiSettings> {
    const parsed = parseJsonObjectDocument(source, "settings.json")
    return {
        value: validateSettingsObject(
            parsed.value,
            PI_SETTINGS_SHAPE,
            "settings.json",
            "$",
            parsed.diagnostics,
        ),
        diagnostics: parsed.diagnostics,
    }
}

export function parseVibeflySettingsJson(
    source: string,
): SettingsValidationResult<VibeflySettings> {
    const parsed = parseJsonObjectDocument(source, "settings.vibefly.json")
    return {
        value: validateSettingsObject(
            parsed.value,
            VIBEFLY_SETTINGS_SHAPE,
            "settings.vibefly.json",
            "$",
            parsed.diagnostics,
        ),
        diagnostics: parsed.diagnostics,
    }
}

export function createEffectiveRevision(
    applicationRevision: string,
    projectRevision: string | null,
): string {
    return JSON.stringify([applicationRevision, projectRevision])
}

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

export interface SettingsManagerAdapter<
    TSnapshot extends SafeSettingsSnapshot = SafeSettingsSnapshot,
> {
    getSettingsSnapshot(scope: SettingsScope): Promise<TSnapshot>
}

export type SettingsManagerChange<
    TSnapshot extends SafeSettingsSnapshot = SafeSettingsSnapshot,
> = {
    scope: SettingsScope | null
    snapshot: TSnapshot | null
    effective: EffectiveSettings
}

export type SettingsManagerListener<
    TSnapshot extends SafeSettingsSnapshot = SafeSettingsSnapshot,
> = (change: SettingsManagerChange<TSnapshot>) => void

type RefreshState = {
    targetRevision?: string
    running?: Promise<void>
}

const MAX_REFRESH_FETCHES = 16
const STABLE_BASELINE_FETCHES = 3
const STABLE_CHANGED_FETCHES = 2

/** Transport-independent snapshot cache and invalidation coordinator. */
export class SettingsManager<
    TSnapshot extends SafeSettingsSnapshot = SafeSettingsSnapshot,
> {
    readonly #listeners = new Set<SettingsManagerListener<TSnapshot>>()
    readonly #refresh: Record<SettingsScope, RefreshState> = {
        application: {},
        project: {},
    }
    #application?: Extract<TSnapshot, { scope: "application" }>
    #project?: Extract<TSnapshot, { scope: "project" }>
    #effective?: EffectiveSettings
    #hasProject = false
    #initialized = false

    constructor(readonly adapter: SettingsManagerAdapter<TSnapshot>) {
    }

    async initialize(hasProject: boolean): Promise<EffectiveSettings> {
        const requested: SettingsScope[] = hasProject
            ? ["application", "project"]
            : ["application"]
        const snapshots = await Promise.all(
            requested.map((scope) => this.adapter.getSettingsSnapshot(scope)),
        )
        const application = snapshots.find((snapshot) => snapshot.scope === "application")
        const project = snapshots.find((snapshot) => snapshot.scope === "project")
        if (!application) throw new Error("Settings adapter did not return an application snapshot")
        assertSnapshotScope(application, "application")
        if (hasProject && !project) {
            throw new Error("Settings adapter did not return a project snapshot")
        }
        if (project) assertSnapshotScope(project, "project")

        this.#application = application as Extract<TSnapshot, { scope: "application" }>
        this.#project = project as Extract<TSnapshot, { scope: "project" }> | undefined
        this.#hasProject = hasProject
        this.#initialized = true
        this.#refresh.application.targetRevision = undefined
        this.#refresh.project.targetRevision = undefined
        this.#effective = this.#computeEffective()
        this.#emit(null, null)
        return this.#effective
    }

    getSnapshot(scope: "application"): Extract<TSnapshot, { scope: "application" }> | undefined
    getSnapshot(scope: "project"): Extract<TSnapshot, { scope: "project" }> | undefined
    getSnapshot(scope: SettingsScope): TSnapshot | undefined {
        return scope === "application" ? this.#application : this.#project
    }

    getEffectiveSettings(): EffectiveSettings | undefined {
        return this.#effective
    }

    subscribe(listener: SettingsManagerListener<TSnapshot>): () => void {
        this.#listeners.add(listener)
        return () => this.#listeners.delete(listener)
    }

    handleSettingsChanged(change: SettingsChanged): Promise<void> {
        if (!this.#initialized) {
            return Promise.reject(new Error("SettingsManager must be initialized before handling changes"))
        }
        if (!this.#accepts(change)) return Promise.resolve()
        const current = change.scope === "application" ? this.#application : this.#project
        const state = this.#refresh[change.scope]
        if (!state.running && current?.revision === change.revision) return Promise.resolve()
        if (state.targetRevision !== change.revision) {
            state.targetRevision = change.revision
        }
        if (!state.running) {
            state.running = this.#drainRefresh(change.scope, state).finally(() => {
                state.running = undefined
            })
        }
        return state.running
    }

    #accepts(change: SettingsChanged): boolean {
        if (change.scope === "application") return change.projectRoot === null
        if (!this.#hasProject || !this.#project) return false
        return change.projectRoot === this.#project.projectRoot
    }

    async #drainRefresh(scope: SettingsScope, state: RefreshState): Promise<void> {
        const current = scope === "application" ? this.#application : this.#project
        let baselineRevision = current?.revision
        let mismatchedRevision: string | undefined
        let mismatchedFetches = 0
        let totalFetches = 0
        while (state.targetRevision !== undefined) {
            const target = state.targetRevision
            const snapshot = await this.adapter.getSettingsSnapshot(scope)
            totalFetches += 1
            assertSnapshotScope(snapshot, scope)
            this.#applySnapshot(snapshot)

            if (state.targetRevision !== target) {
                baselineRevision = snapshot.revision
                mismatchedRevision = undefined
                mismatchedFetches = 0
                totalFetches = 0
                continue
            }
            if (snapshot.revision === target) {
                state.targetRevision = undefined
                break
            }

            if (mismatchedRevision === snapshot.revision) mismatchedFetches += 1
            else {
                mismatchedRevision = snapshot.revision
                mismatchedFetches = 1
            }
            const stableThreshold = snapshot.revision === baselineRevision
                ? STABLE_BASELINE_FETCHES
                : STABLE_CHANGED_FETCHES

            // Revisions are opaque, so a late stale notification cannot be ordered
            // against the current cache. A repeatedly authoritative RPC snapshot is
            // accepted after a small propagation-lag window. The hard cap also keeps
            // continuous revision churn from pinning the consumer forever.
            if (mismatchedFetches >= stableThreshold || totalFetches >= MAX_REFRESH_FETCHES) {
                state.targetRevision = undefined
                break
            }
        }
    }

    #applySnapshot(snapshot: TSnapshot): void {
        if (snapshot.scope === "application") {
            const current = this.#application
            if (current?.revision === snapshot.revision) return
            this.#application = snapshot as Extract<TSnapshot, { scope: "application" }>
        } else {
            const current = this.#project
            if (current && current.projectRoot !== snapshot.projectRoot) {
                throw new Error("Settings adapter returned a snapshot for another project")
            }
            if (current?.revision === snapshot.revision) return
            this.#project = snapshot as Extract<TSnapshot, { scope: "project" }>
        }
        this.#effective = this.#computeEffective()
        this.#emit(snapshot.scope, snapshot)
    }

    #computeEffective(): EffectiveSettings {
        if (!this.#application) throw new Error("Application settings snapshot is unavailable")
        if (this.#hasProject && !this.#project) {
            throw new Error("Project settings snapshot is unavailable")
        }
        return computeEffectiveSettings(this.#application, this.#project)
    }

    #emit(scope: SettingsScope | null, snapshot: TSnapshot | null): void {
        if (!this.#effective) return
        const change: SettingsManagerChange<TSnapshot> = {
            scope,
            snapshot,
            effective: this.#effective,
        }
        for (const listener of this.#listeners) listener(change)
    }
}
