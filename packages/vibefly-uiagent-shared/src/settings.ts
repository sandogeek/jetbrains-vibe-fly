import Type, {type Static, type TObject, type TProperties, type TSchema} from "typebox"
import {Check, Errors} from "typebox/value"

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

type SchemaExpected = TSchema & {expected?: string}

function openObject(properties: TProperties, expected = "an object"): TObject {
    return Type.Object(properties, {additionalProperties: true, expected}) as TObject
}

function optionalNullable(schema: TSchema, expected: string): TSchema {
    return Type.Optional(Type.Union([schema, Type.Null()], {expected}))
}

function optionalString(expected = "a string"): TSchema {
    return optionalNullable(Type.String({expected}), expected)
}

function optionalBoolean(expected = "a boolean"): TSchema {
    return optionalNullable(Type.Boolean({expected}), expected)
}

function optionalNonNegativeNumber(expected = "a non-negative number"): TSchema {
    return optionalNullable(Type.Number({minimum: 0, expected}), expected)
}

function optionalStringArray(expected = "an array of strings"): TSchema {
    return optionalNullable(Type.Array(Type.String({expected: "a string"}), {expected}), expected)
}

function optionalEnum(values: readonly string[], expected: string): TSchema {
    return optionalNullable(
        Type.Union(values.map((value) => Type.Literal(value)), {expected}),
        expected,
    )
}

export const PiCompactionSettingsSchema = openObject({
    enabled: optionalBoolean(),
    reserveTokens: optionalNonNegativeNumber(),
    keepRecentTokens: optionalNonNegativeNumber(),
})

export const PiRetryProviderSettingsSchema = openObject({
    timeoutMs: optionalNonNegativeNumber(),
    maxRetries: optionalNonNegativeNumber(),
    maxRetryDelayMs: optionalNonNegativeNumber(),
})

export const PiRetrySettingsSchema = openObject({
    enabled: optionalBoolean(),
    maxRetries: optionalNonNegativeNumber(),
    baseDelayMs: optionalNonNegativeNumber(),
    provider: optionalNullable(PiRetryProviderSettingsSchema, "an object"),
})

export const PiBranchSummarySettingsSchema = openObject({
    reserveTokens: optionalNonNegativeNumber(),
    skipPrompt: optionalBoolean(),
})

export const PiTerminalSettingsSchema = openObject({
    showImages: optionalBoolean(),
    imageWidthCells: optionalNonNegativeNumber(),
    clearOnShrink: optionalBoolean(),
    showTerminalProgress: optionalBoolean(),
})

export const PiImageSettingsSchema = openObject({
    autoResize: optionalBoolean(),
    blockImages: optionalBoolean(),
})

export const PiThinkingBudgetsSettingsSchema = openObject({
    minimal: optionalNonNegativeNumber(),
    low: optionalNonNegativeNumber(),
    medium: optionalNonNegativeNumber(),
    high: optionalNonNegativeNumber(),
})

export const PiMarkdownSettingsSchema = openObject({
    codeBlockIndent: optionalString(),
})

export const PiWarningSettingsSchema = openObject({
    anthropicExtraUsage: optionalBoolean(),
})

export const PiPackageSettingsSchema = openObject({
    source: Type.String({expected: "a string"}),
    autoload: Type.Optional(Type.Boolean({expected: "a boolean"})),
    extensions: Type.Optional(Type.Array(Type.String({expected: "a string"}), {
        expected: "an array of strings",
    })),
    skills: Type.Optional(Type.Array(Type.String({expected: "a string"}), {
        expected: "an array of strings",
    })),
    prompts: Type.Optional(Type.Array(Type.String({expected: "a string"}), {
        expected: "an array of strings",
    })),
    themes: Type.Optional(Type.Array(Type.String({expected: "a string"}), {
        expected: "an array of strings",
    })),
})

const packageSourcesExpected = "an array of package sources"
export const PiPackageSourceSchema = Type.Union([
    Type.String({expected: "a string"}),
    PiPackageSettingsSchema,
], {expected: packageSourcesExpected})

export const PiSettingsSchema = openObject({
    lastChangelogVersion: optionalString(),
    defaultProvider: optionalString(),
    defaultModel: optionalString(),
    defaultThinkingLevel: optionalEnum(
        ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
        "a supported thinking level",
    ),
    steeringMode: optionalEnum(["all", "one-at-a-time"], "a supported queue mode"),
    followUpMode: optionalEnum(["all", "one-at-a-time"], "a supported queue mode"),
    transport: optionalEnum(
        ["auto", "sse", "websocket", "websocket-cached"],
        "auto, sse, websocket, or websocket-cached",
    ),
    theme: optionalString(),
    compaction: optionalNullable(PiCompactionSettingsSchema, "an object"),
    branchSummary: optionalNullable(PiBranchSummarySettingsSchema, "an object"),
    retry: optionalNullable(PiRetrySettingsSchema, "an object"),
    hideThinkingBlock: optionalBoolean(),
    showCacheMissNotices: optionalBoolean(),
    externalEditor: optionalString(),
    shellPath: optionalString(),
    quietStartup: optionalBoolean(),
    defaultProjectTrust: optionalEnum(["ask", "always", "never"], "ask, always, or never"),
    shellCommandPrefix: optionalString(),
    npmCommand: optionalStringArray(),
    collapseChangelog: optionalBoolean(),
    enableInstallTelemetry: optionalBoolean(),
    enableAnalytics: optionalBoolean(),
    trackingId: optionalString(),
    packages: optionalNullable(
        Type.Array(PiPackageSourceSchema, {expected: packageSourcesExpected}),
        packageSourcesExpected,
    ),
    extensions: optionalStringArray(),
    skills: optionalStringArray(),
    prompts: optionalStringArray(),
    themes: optionalStringArray(),
    enableSkillCommands: optionalBoolean(),
    terminal: optionalNullable(PiTerminalSettingsSchema, "an object"),
    images: optionalNullable(PiImageSettingsSchema, "an object"),
    enabledModels: optionalStringArray(),
    doubleEscapeAction: optionalEnum(["fork", "tree", "none"], "fork, tree, or none"),
    treeFilterMode: optionalEnum(
        ["default", "no-tools", "user-only", "labeled-only", "all"],
        "a supported tree filter mode",
    ),
    thinkingBudgets: optionalNullable(PiThinkingBudgetsSettingsSchema, "an object"),
    editorPaddingX: optionalNonNegativeNumber(),
    outputPad: optionalNullable(
        Type.Union([Type.Literal(0), Type.Literal(1)], {expected: "0 or 1"}),
        "0 or 1",
    ),
    autocompleteMaxVisible: optionalNonNegativeNumber(),
    showHardwareCursor: optionalBoolean(),
    markdown: optionalNullable(PiMarkdownSettingsSchema, "an object"),
    warnings: optionalNullable(PiWarningSettingsSchema, "an object"),
    sessionDir: optionalString(),
    httpProxy: optionalString(),
    httpIdleTimeoutMs: optionalNonNegativeNumber(),
    websocketConnectTimeoutMs: optionalNonNegativeNumber(),
})

export const VibeflyCommitSettingsSchema = openObject({
    languageMode: optionalEnum(["follow_ide", "en", "zh"], "follow_ide, en, or zh"),
    commitModelSpec: optionalString(),
    useCustomPrompt: optionalBoolean(),
    customPrompt: optionalString(),
})

export const VibeflyModelPreferencesSchema = openObject({
    recentModelSpecs: optionalStringArray(),
    pinnedModelSpecs: optionalStringArray(),
})

export const VibeflyUiSettingsSchema = openObject({
    locale: optionalEnum(["follow_ide", "en", "zh"], "follow_ide, en, or zh"),
})

export const VibeflySettingsSchema = openObject({
    commit: optionalNullable(VibeflyCommitSettingsSchema, "an object"),
    modelPreferences: optionalNullable(VibeflyModelPreferencesSchema, "an object"),
    ui: optionalNullable(VibeflyUiSettingsSchema, "an object"),
})

export type PiCompactionSettings = JsonObject & Static<typeof PiCompactionSettingsSchema>
export type PiRetryProviderSettings = JsonObject & Static<typeof PiRetryProviderSettingsSchema>
export type PiRetrySettings = JsonObject & Static<typeof PiRetrySettingsSchema>
export type PiBranchSummarySettings = JsonObject & Static<typeof PiBranchSummarySettingsSchema>
export type PiTerminalSettings = JsonObject & Static<typeof PiTerminalSettingsSchema>
export type PiImageSettings = JsonObject & Static<typeof PiImageSettingsSchema>
export type PiThinkingBudgetsSettings = JsonObject & Static<typeof PiThinkingBudgetsSettingsSchema>
export type PiMarkdownSettings = JsonObject & Static<typeof PiMarkdownSettingsSchema>
export type PiWarningSettings = JsonObject & Static<typeof PiWarningSettingsSchema>
export type PiPackageSettings = JsonObject & Static<typeof PiPackageSettingsSchema>
export type PiPackageSource = Static<typeof PiPackageSourceSchema>
export type PiSettings = JsonObject & Static<typeof PiSettingsSchema>
export type VibeflyCommitSettings = JsonObject & Static<typeof VibeflyCommitSettingsSchema>
export type VibeflyModelPreferences = JsonObject & Static<typeof VibeflyModelPreferencesSchema>
export type VibeflyUiSettings = JsonObject & Static<typeof VibeflyUiSettingsSchema>
export type VibeflySettings = JsonObject & Static<typeof VibeflySettingsSchema>

export type SettingsValidationResult<T extends JsonObject> = {
    value: T
    diagnostics: SettingsDiagnostic[]
}

export type EffectiveSettings = {
    settings: PiSettings
    vibefly: VibeflySettings
    revision: string
    applicationRevision: string
    projectRevision: string | null
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

function isObjectSchema(schema: TSchema): schema is TObject {
    const candidate = schema as {type?: unknown; properties?: unknown}
    return candidate.type === "object"
        && typeof candidate.properties === "object"
        && candidate.properties !== null
        && !Array.isArray(candidate.properties)
}

function schemaVariants(schema: TSchema): TSchema[] {
    const anyOf = (schema as {anyOf?: TSchema[]}).anyOf
    return Array.isArray(anyOf) && anyOf.length > 0 ? anyOf : [schema]
}

function nonNullVariants(schema: TSchema): TSchema[] {
    return schemaVariants(schema).filter((variant) => (variant as {type?: unknown}).type !== "null")
}

function findObjectSchema(schema: TSchema): TObject | undefined {
    for (const variant of nonNullVariants(schema)) {
        if (isObjectSchema(variant)) return variant
    }
    return undefined
}

function expectedFromTypeBoxErrors(schema: TSchema, value: unknown): string | undefined {
    for (const error of Errors(schema, value)) {
        if (error.keyword === "anyOf" || error.keyword === "oneOf") continue
        if (error.keyword === "type") {
            const type = (error.params as {type?: string} | undefined)?.type
            if (type === "string") return "a string"
            if (type === "boolean") return "a boolean"
            if (type === "number" || type === "integer") return "a number"
            if (type === "object") return "an object"
            if (type === "array") return "an array"
            if (type === "null") continue
        }
        if (error.keyword === "minimum" || error.keyword === "exclusiveMinimum") {
            return "a non-negative number"
        }
        if (error.keyword === "const" || error.keyword === "enum") {
            return "a supported value"
        }
    }
    return undefined
}

function expectedForSchema(schema: TSchema, value: unknown): string {
    const annotated = (schema as SchemaExpected).expected
    if (typeof annotated === "string" && annotated.length > 0) return annotated
    for (const variant of nonNullVariants(schema)) {
        const nested = (variant as SchemaExpected).expected
        if (typeof nested === "string" && nested.length > 0) return nested
    }
    return expectedFromTypeBoxErrors(schema, value) ?? "a valid value"
}

/**
 * Tolerant sanitizer: validate known fields via TypeBox, keep unknown fields,
 * delete the smallest invalid known field. Arrays are validated as a whole.
 */
function sanitizeKnownObject(
    schema: TObject,
    value: JsonObject,
    path: string,
    file: SettingsFileName,
    diagnostics: SettingsDiagnostic[],
): void {
    const properties = schema.properties ?? {}
    for (const key of Object.keys(properties)) {
        if (!hasOwn(value, key)) continue
        const fieldSchema = properties[key]! as TSchema
        const current = value[key]
        if (Check(fieldSchema, current)) continue

        const objectSchema = findObjectSchema(fieldSchema)
        if (objectSchema && isJsonObject(current)) {
            sanitizeKnownObject(objectSchema, current, `${path}.${key}`, file, diagnostics)
            if (Check(fieldSchema, current)) continue
        }

        delete value[key]
        diagnostics.push({
            file,
            severity: "error",
            message: `${path}.${key} must be ${expectedForSchema(fieldSchema, current)}`,
        })
    }
}

function sanitizeSettingsObject<T extends JsonObject>(
    schema: TObject,
    value: JsonObject,
    file: SettingsFileName,
    diagnostics: SettingsDiagnostic[],
): T {
    sanitizeKnownObject(schema, value, "$", file, diagnostics)
    return value as T
}

export function parsePiSettingsJson(source: string): SettingsValidationResult<PiSettings> {
    const parsed = parseJsonObjectDocument(source, "settings.json")
    return {
        value: sanitizeSettingsObject<PiSettings>(
            PiSettingsSchema,
            parsed.value,
            "settings.json",
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
        value: sanitizeSettingsObject<VibeflySettings>(
            VibeflySettingsSchema,
            parsed.value,
            "settings.vibefly.json",
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
