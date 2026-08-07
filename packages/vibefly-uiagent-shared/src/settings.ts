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

export type PiCompactionSettings = JsonObject & {
    enabled?: boolean | null
    reserveTokens?: number | null
    keepRecentTokens?: number | null
}

export type PiRetryProviderSettings = JsonObject & {
    timeoutMs?: number | null
    maxRetries?: number | null
    maxRetryDelayMs?: number | null
}

export type PiRetrySettings = JsonObject & {
    enabled?: boolean | null
    maxRetries?: number | null
    baseDelayMs?: number | null
    provider?: PiRetryProviderSettings | null
}

export type PiBranchSummarySettings = JsonObject & {
    reserveTokens?: number | null
    skipPrompt?: boolean | null
}

export type PiTerminalSettings = JsonObject & {
    showImages?: boolean | null
    imageWidthCells?: number | null
    clearOnShrink?: boolean | null
    showTerminalProgress?: boolean | null
}

export type PiImageSettings = JsonObject & {
    autoResize?: boolean | null
    blockImages?: boolean | null
}

export type PiThinkingBudgetsSettings = JsonObject & {
    minimal?: number | null
    low?: number | null
    medium?: number | null
    high?: number | null
}

export type PiMarkdownSettings = JsonObject & {
    codeBlockIndent?: string | null
}

export type PiWarningSettings = JsonObject & {
    anthropicExtraUsage?: boolean | null
}

export type PiPackageSettings = JsonObject & {
    source: string
    autoload?: boolean
    extensions?: string[]
    skills?: string[]
    prompts?: string[]
    themes?: string[]
}

export type PiPackageSource = string | PiPackageSettings

export type PiSettings = JsonObject & {
    lastChangelogVersion?: string | null
    defaultProvider?: string | null
    defaultModel?: string | null
    defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null
    steeringMode?: "all" | "one-at-a-time" | null
    followUpMode?: "all" | "one-at-a-time" | null
    transport?: "auto" | "sse" | "websocket" | "websocket-cached" | null
    theme?: string | null
    compaction?: PiCompactionSettings | null
    branchSummary?: PiBranchSummarySettings | null
    retry?: PiRetrySettings | null
    hideThinkingBlock?: boolean | null
    showCacheMissNotices?: boolean | null
    externalEditor?: string | null
    shellPath?: string | null
    quietStartup?: boolean | null
    defaultProjectTrust?: "ask" | "always" | "never" | null
    shellCommandPrefix?: string | null
    npmCommand?: string[] | null
    collapseChangelog?: boolean | null
    enableInstallTelemetry?: boolean | null
    enableAnalytics?: boolean | null
    trackingId?: string | null
    packages?: PiPackageSource[] | null
    extensions?: string[] | null
    skills?: string[] | null
    prompts?: string[] | null
    themes?: string[] | null
    enableSkillCommands?: boolean | null
    terminal?: PiTerminalSettings | null
    images?: PiImageSettings | null
    enabledModels?: string[] | null
    doubleEscapeAction?: "fork" | "tree" | "none" | null
    treeFilterMode?: "default" | "no-tools" | "user-only" | "labeled-only" | "all" | null
    thinkingBudgets?: PiThinkingBudgetsSettings | null
    editorPaddingX?: number | null
    outputPad?: 0 | 1 | null
    autocompleteMaxVisible?: number | null
    showHardwareCursor?: boolean | null
    markdown?: PiMarkdownSettings | null
    warnings?: PiWarningSettings | null
    sessionDir?: string | null
    httpProxy?: string | null
    httpIdleTimeoutMs?: number | null
    websocketConnectTimeoutMs?: number | null
}

export type VibeflyCommitSettings = JsonObject & {
    languageMode?: "follow_ide" | "en" | "zh" | null
    commitModelSpec?: string | null
    useCustomPrompt?: boolean | null
    customPrompt?: string | null
}

export type VibeflyModelPreferences = JsonObject & {
    recentModelSpecs?: string[] | null
    pinnedModelSpecs?: string[] | null
}

export type VibeflyUiSettings = JsonObject & {
    locale?: "follow_ide" | "en" | "zh" | null
}

export type VibeflySettings = JsonObject & {
    commit?: VibeflyCommitSettings | null
    modelPreferences?: VibeflyModelPreferences | null
    ui?: VibeflyUiSettings | null
}

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

const THINKING_LEVELS = new Set([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
])
const TRANSPORTS = new Set(["auto", "sse", "websocket", "websocket-cached"])
const QUEUE_MODES = new Set(["all", "one-at-a-time"])
const LOCALE_MODES = new Set(["follow_ide", "en", "zh"])
const PROJECT_TRUST_MODES = new Set(["ask", "always", "never"])
const DOUBLE_ESCAPE_ACTIONS = new Set(["fork", "tree", "none"])
const TREE_FILTER_MODES = new Set([
    "default",
    "no-tools",
    "user-only",
    "labeled-only",
    "all",
])

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

type Validator = (value: JsonValue) => boolean

function stringValue(value: JsonValue): boolean {
    return typeof value === "string"
}

function booleanValue(value: JsonValue): boolean {
    return typeof value === "boolean"
}

function numberValue(value: JsonValue): boolean {
    return typeof value === "number" && Number.isFinite(value)
}

function nonNegativeNumber(value: JsonValue): boolean {
    return numberValue(value) && (value as number) >= 0
}

function stringArray(value: JsonValue): boolean {
    return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function packageSources(value: JsonValue): boolean {
    if (!Array.isArray(value)) return false
    return value.every((entry) => {
        if (typeof entry === "string") return true
        if (!isJsonObject(entry) || typeof entry.source !== "string") return false
        if (hasOwn(entry, "autoload") && typeof entry.autoload !== "boolean") return false
        for (const key of ["extensions", "skills", "prompts", "themes"]) {
            if (hasOwn(entry, key) && !stringArray(entry[key]!)) return false
        }
        return true
    })
}

function enumValue(values: ReadonlySet<string>): Validator {
    return (value) => typeof value === "string" && values.has(value)
}

function validateProperty(
    object: JsonObject,
    key: string,
    validator: Validator,
    expected: string,
    file: SettingsFileName,
    path: string,
    diagnostics: SettingsDiagnostic[],
): void {
    if (!hasOwn(object, key)) return
    if (object[key] === null) return
    if (validator(object[key]!)) return
    delete object[key]
    diagnostics.push({
        file,
        severity: "error",
        message: `${path}.${key} must be ${expected}`,
    })
}

function validateObjectProperty(
    object: JsonObject,
    key: string,
    file: SettingsFileName,
    path: string,
    diagnostics: SettingsDiagnostic[],
    validate: (nested: JsonObject, nestedPath: string) => void,
): void {
    if (!hasOwn(object, key)) return
    const nested = object[key]
    if (nested === null) return
    if (!isJsonObject(nested)) {
        delete object[key]
        diagnostics.push({
            file,
            severity: "error",
            message: `${path}.${key} must be an object`,
        })
        return
    }
    validate(nested, `${path}.${key}`)
}

function validatePiSettingsObject(
    value: JsonObject,
    diagnostics: SettingsDiagnostic[],
): PiSettings {
    const file = "settings.json" as const
    const root = "$"

    for (const key of [
        "lastChangelogVersion",
        "defaultProvider",
        "defaultModel",
        "theme",
        "externalEditor",
        "shellPath",
        "shellCommandPrefix",
        "trackingId",
        "sessionDir",
        "httpProxy",
    ]) {
        validateProperty(value, key, stringValue, "a string", file, root, diagnostics)
    }
    for (const key of [
        "hideThinkingBlock",
        "showCacheMissNotices",
        "quietStartup",
        "collapseChangelog",
        "enableInstallTelemetry",
        "enableAnalytics",
        "enableSkillCommands",
        "showHardwareCursor",
    ]) {
        validateProperty(value, key, booleanValue, "a boolean", file, root, diagnostics)
    }
    for (const key of [
        "editorPaddingX",
        "autocompleteMaxVisible",
        "httpIdleTimeoutMs",
        "websocketConnectTimeoutMs",
    ]) {
        validateProperty(value, key, nonNegativeNumber, "a non-negative number", file, root, diagnostics)
    }
    for (const key of ["extensions", "skills", "prompts", "themes", "npmCommand", "enabledModels"]) {
        validateProperty(value, key, stringArray, "an array of strings", file, root, diagnostics)
    }
    validateProperty(
        value,
        "defaultThinkingLevel",
        enumValue(THINKING_LEVELS),
        "a supported thinking level",
        file,
        root,
        diagnostics,
    )
    validateProperty(
        value,
        "transport",
        enumValue(TRANSPORTS),
        "auto, sse, websocket, or websocket-cached",
        file,
        root,
        diagnostics,
    )
    validateProperty(value, "steeringMode", enumValue(QUEUE_MODES), "a supported queue mode", file, root, diagnostics)
    validateProperty(value, "followUpMode", enumValue(QUEUE_MODES), "a supported queue mode", file, root, diagnostics)
    validateProperty(
        value,
        "defaultProjectTrust",
        enumValue(PROJECT_TRUST_MODES),
        "ask, always, or never",
        file,
        root,
        diagnostics,
    )
    validateProperty(
        value,
        "doubleEscapeAction",
        enumValue(DOUBLE_ESCAPE_ACTIONS),
        "fork, tree, or none",
        file,
        root,
        diagnostics,
    )
    validateProperty(
        value,
        "treeFilterMode",
        enumValue(TREE_FILTER_MODES),
        "a supported tree filter mode",
        file,
        root,
        diagnostics,
    )
    validateProperty(
        value,
        "packages",
        packageSources,
        "an array of package sources",
        file,
        root,
        diagnostics,
    )
    validateProperty(
        value,
        "outputPad",
        (entry) => entry === 0 || entry === 1,
        "0 or 1",
        file,
        root,
        diagnostics,
    )

    validateObjectProperty(value, "compaction", file, root, diagnostics, (nested, path) => {
        validateProperty(nested, "enabled", booleanValue, "a boolean", file, path, diagnostics)
        validateProperty(nested, "reserveTokens", nonNegativeNumber, "a non-negative number", file, path, diagnostics)
        validateProperty(nested, "keepRecentTokens", nonNegativeNumber, "a non-negative number", file, path, diagnostics)
    })
    validateObjectProperty(value, "branchSummary", file, root, diagnostics, (nested, path) => {
        validateProperty(nested, "reserveTokens", nonNegativeNumber, "a non-negative number", file, path, diagnostics)
        validateProperty(nested, "skipPrompt", booleanValue, "a boolean", file, path, diagnostics)
    })
    validateObjectProperty(value, "retry", file, root, diagnostics, (nested, path) => {
        validateProperty(nested, "enabled", booleanValue, "a boolean", file, path, diagnostics)
        validateProperty(nested, "maxRetries", nonNegativeNumber, "a non-negative number", file, path, diagnostics)
        validateProperty(nested, "baseDelayMs", nonNegativeNumber, "a non-negative number", file, path, diagnostics)
        validateObjectProperty(nested, "provider", file, path, diagnostics, (provider, providerPath) => {
            validateProperty(provider, "timeoutMs", nonNegativeNumber, "a non-negative number", file, providerPath, diagnostics)
            validateProperty(provider, "maxRetries", nonNegativeNumber, "a non-negative number", file, providerPath, diagnostics)
            validateProperty(provider, "maxRetryDelayMs", nonNegativeNumber, "a non-negative number", file, providerPath, diagnostics)
        })
    })
    validateObjectProperty(value, "terminal", file, root, diagnostics, (nested, path) => {
        validateProperty(nested, "showImages", booleanValue, "a boolean", file, path, diagnostics)
        validateProperty(nested, "imageWidthCells", nonNegativeNumber, "a non-negative number", file, path, diagnostics)
        validateProperty(nested, "clearOnShrink", booleanValue, "a boolean", file, path, diagnostics)
        validateProperty(nested, "showTerminalProgress", booleanValue, "a boolean", file, path, diagnostics)
    })
    validateObjectProperty(value, "images", file, root, diagnostics, (nested, path) => {
        validateProperty(nested, "autoResize", booleanValue, "a boolean", file, path, diagnostics)
        validateProperty(nested, "blockImages", booleanValue, "a boolean", file, path, diagnostics)
    })
    validateObjectProperty(value, "thinkingBudgets", file, root, diagnostics, (nested, path) => {
        for (const key of ["minimal", "low", "medium", "high"]) {
            validateProperty(nested, key, nonNegativeNumber, "a non-negative number", file, path, diagnostics)
        }
    })
    validateObjectProperty(value, "markdown", file, root, diagnostics, (nested, path) => {
        validateProperty(nested, "codeBlockIndent", stringValue, "a string", file, path, diagnostics)
    })
    validateObjectProperty(value, "warnings", file, root, diagnostics, (nested, path) => {
        validateProperty(nested, "anthropicExtraUsage", booleanValue, "a boolean", file, path, diagnostics)
    })
    return value as PiSettings
}

export function parsePiSettingsJson(source: string): SettingsValidationResult<PiSettings> {
    const parsed = parseJsonObjectDocument(source, "settings.json")
    return {
        value: validatePiSettingsObject(parsed.value, parsed.diagnostics),
        diagnostics: parsed.diagnostics,
    }
}

function validateVibeflySettingsObject(
    value: JsonObject,
    diagnostics: SettingsDiagnostic[],
): VibeflySettings {
    const file = "settings.vibefly.json" as const
    const root = "$"
    validateObjectProperty(value, "commit", file, root, diagnostics, (nested, path) => {
        validateProperty(nested, "languageMode", enumValue(LOCALE_MODES), "follow_ide, en, or zh", file, path, diagnostics)
        validateProperty(nested, "commitModelSpec", stringValue, "a string", file, path, diagnostics)
        validateProperty(nested, "useCustomPrompt", booleanValue, "a boolean", file, path, diagnostics)
        validateProperty(nested, "customPrompt", stringValue, "a string", file, path, diagnostics)
    })
    validateObjectProperty(value, "modelPreferences", file, root, diagnostics, (nested, path) => {
        validateProperty(nested, "recentModelSpecs", stringArray, "an array of strings", file, path, diagnostics)
        validateProperty(nested, "pinnedModelSpecs", stringArray, "an array of strings", file, path, diagnostics)
    })
    validateObjectProperty(value, "ui", file, root, diagnostics, (nested, path) => {
        validateProperty(nested, "locale", enumValue(LOCALE_MODES), "follow_ide, en, or zh", file, path, diagnostics)
    })
    return value as VibeflySettings
}

export function parseVibeflySettingsJson(
    source: string,
): SettingsValidationResult<VibeflySettings> {
    const parsed = parseJsonObjectDocument(source, "settings.vibefly.json")
    return {
        value: validateVibeflySettingsObject(parsed.value, parsed.diagnostics),
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
