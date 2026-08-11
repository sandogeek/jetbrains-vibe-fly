import type {Api, Credential, CredentialInfo, CredentialStore, Model} from "@earendil-works/pi-ai"
import {type ModelRuntime, SettingsManager as PiSettingsManager,} from "@earendil-works/pi-coding-agent"
import {
    type EffectiveSettings,
    isJsonObject,
    type JsonObject,
    type JsonValue,
    type SettingsChanged,
    SettingsManager as SnapshotSettingsManager,
    type SettingsManagerAdapter,
} from "@vibefly/uiagent-shared"
import {
    type AgentApplicationSettingsSnapshot,
    type AgentSettingsSnapshot,
    type CredentialMap,
    deleteCredential,
    getCredential,
    normalizeAgentSettingsSnapshot,
    parseAuthJson,
    parseModelsJson,
    setCredential,
} from "@vibefly/uiagent-shared/agent"
import type {
    AgentSettingsSnapshot as WireSettingsSnapshot,
    AuthSaveRequest,
    GenerateCommitMessageRequest,
    SettingsSaveResult,
} from "./generated/controlRpc.js"
import {log} from "./log.js"

type SettingsStorage = Parameters<typeof PiSettingsManager.fromStorage>[0]

export interface HostSettingsRpc {
    getSettingsSnapshot(scope: string): Promise<WireSettingsSnapshot>

    saveAuth(request: AuthSaveRequest): Promise<SettingsSaveResult>
}

type ProviderConfigInput = Parameters<ModelRuntime["registerProvider"]>[1]

export type HostModelRuntime = Pick<
    ModelRuntime,
    "getModels" | "refresh" | "registerProvider" | "unregisterProvider"
>

export type HostSettingsControllerOptions = {
    hasProject: boolean
    reloadLiveSessions?: (modelCatalogChanged: boolean) => Promise<void>
}

function configuredModelSpec(settings: EffectiveSettings): string | undefined {
    const model = requiredString(settings.settings.defaultModel)
    if (!model) return undefined
    if (model.includes("/")) return model
    const provider = requiredString(settings.settings.defaultProvider)
    return provider ? `${provider}/${model}` : undefined
}

export function applyEffectiveCommitSettings(
    request: GenerateCommitMessageRequest,
    effective: EffectiveSettings,
): GenerateCommitMessageRequest {
    const commit = effective.vibefly.commit
    const languageMode = commit?.languageMode
    const commitModel = typeof commit?.commitModelSpec === "string"
        ? commit.commitModelSpec.trim() || null
        : request.commitModel
    const defaultModel = configuredModelSpec(effective) ?? request.defaultModel
    const language = languageMode === "en" || languageMode === "zh"
        ? languageMode
        : request.language
    const customPrompt = typeof commit?.useCustomPrompt === "boolean"
        ? commit.useCustomPrompt
            ? requiredString(commit.customPrompt) ?? null
            : null
        : request.customPrompt
    return {
        ...request,
        commitModel,
        defaultModel,
        language,
        customPrompt,
    }
}

function cloneCredential(credential: Credential | undefined): Credential | undefined {
    return credential === undefined ? undefined : structuredClone(credential)
}

function asCredential(value: JsonObject | undefined): Credential | undefined {
    if (!value) return undefined
    if (value.type !== "api_key" && value.type !== "oauth") return undefined
    return structuredClone(value) as unknown as Credential
}

function credentialMapToJson(credentials: CredentialMap): string {
    return `${JSON.stringify(credentials, null, 2)}\n`
}

function fingerprint(value: JsonValue): string {
    if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`
    if (value !== null && typeof value === "object") {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${fingerprint(value[key]!)}`)
            .join(",")}}`
    }
    return JSON.stringify(value)
}

function requiredString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed || undefined
}

function finiteNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function stringRecord(value: unknown): Record<string, string> | undefined {
    if (!isJsonObject(value)) return undefined
    const entries = Object.entries(value).filter((entry): entry is [string, string] =>
        typeof entry[1] === "string",
    )
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

type PiModel = Model<Api>

function mergeCompat(...values: unknown[]): JsonObject | undefined {
    let merged: JsonObject | undefined
    for (const value of values) {
        if (!isJsonObject(value)) continue
        const next = merged ? structuredClone(merged) : {}
        for (const [key, child] of Object.entries(value)) {
            const previous = next[key]
            const nested = key === "openRouterRouting" ||
                key === "vercelGatewayRouting" ||
                key === "chatTemplateKwargs"
            if (nested && isJsonObject(previous) && isJsonObject(child)) {
                next[key] = mergeCompat(previous, child)!
            } else {
                next[key] = structuredClone(child)
            }
        }
        merged = next
    }
    return merged && Object.keys(merged).length > 0 ? merged : undefined
}

function modelOverride(raw: JsonObject, modelId: string): JsonObject | undefined {
    const overrides = isJsonObject(raw.modelOverrides) ? raw.modelOverrides : undefined
    return overrides && isJsonObject(overrides[modelId]) ? overrides[modelId] : undefined
}

function modelAsJson(model: PiModel): JsonObject {
    const output: JsonObject = {
        id: model.id,
        name: model.name,
        api: model.api,
        baseUrl: model.baseUrl,
        reasoning: model.reasoning,
        input: [...model.input],
        cost: structuredClone(model.cost) as unknown as JsonObject,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
    }
    if (model.thinkingLevelMap) {
        output.thinkingLevelMap = structuredClone(model.thinkingLevelMap) as unknown as JsonObject
    }
    if (model.headers) output.headers = structuredClone(model.headers)
    if (model.compat) output.compat = structuredClone(model.compat) as unknown as JsonObject
    return output
}

function finitePositiveNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function modelInput(value: unknown): ("text" | "image")[] {
    if (!Array.isArray(value)) return ["text"]
    const result = value.filter((item): item is "text" | "image" => item === "text" || item === "image")
    return result.length > 0 ? result : ["text"]
}

function modelHeaders(...values: unknown[]): Record<string, string> | undefined {
    const merged: Record<string, string> = {}
    for (const value of values) {
        const record = stringRecord(value)
        if (record) Object.assign(merged, record)
    }
    return Object.keys(merged).length > 0 ? merged : undefined
}

function modelCost(base: unknown, override: unknown): JsonObject {
    const baseCost = isJsonObject(base) ? base : {}
    const overrideCost = isJsonObject(override) ? override : {}
    return {
        input: finiteNumber(overrideCost.input, finiteNumber(baseCost.input, 0)),
        output: finiteNumber(overrideCost.output, finiteNumber(baseCost.output, 0)),
        cacheRead: finiteNumber(overrideCost.cacheRead, finiteNumber(baseCost.cacheRead, 0)),
        cacheWrite: finiteNumber(overrideCost.cacheWrite, finiteNumber(baseCost.cacheWrite, 0)),
        ...(Array.isArray(overrideCost.tiers)
            ? {tiers: structuredClone(overrideCost.tiers)}
            : Array.isArray(baseCost.tiers) ? {tiers: structuredClone(baseCost.tiers)} : {}),
    }
}

function buildModelDefinition(
    rawProvider: JsonObject,
    candidate: JsonObject,
    isBaseModel: boolean,
): NonNullable<ProviderConfigInput["models"]>[number] | undefined {
    const id = requiredString(candidate.id)
    if (!id) return undefined
    const override = modelOverride(rawProvider, id) ?? {}
    const name = requiredString(override.name) ?? requiredString(candidate.name) ?? id
    const api = requiredString(candidate.api) ?? requiredString(rawProvider.api)
    const baseUrl = isBaseModel
        ? rawProvider.oauth === "radius"
            ? requiredString(candidate.baseUrl)
            : requiredString(rawProvider.baseUrl) ?? requiredString(candidate.baseUrl)
        : requiredString(candidate.baseUrl) ?? requiredString(rawProvider.baseUrl)
    const input = modelInput(override.input ?? candidate.input)
    const candidateCost = modelCost(candidate.cost, override.cost)
    const headers = modelHeaders(candidate.headers, override.headers)
    const compat = isBaseModel
        ? mergeCompat(candidate.compat, rawProvider.compat, override.compat)
        : mergeCompat(rawProvider.compat, candidate.compat, override.compat)
    const model: NonNullable<ProviderConfigInput["models"]>[number] = {
        id,
        name,
        reasoning: typeof override.reasoning === "boolean"
            ? override.reasoning
            : typeof candidate.reasoning === "boolean" ? candidate.reasoning : false,
        input,
        cost: candidateCost as never,
        contextWindow: finitePositiveNumber(override.contextWindow, finitePositiveNumber(candidate.contextWindow, 128_000)),
        maxTokens: finitePositiveNumber(override.maxTokens, finitePositiveNumber(candidate.maxTokens, 16_384)),
    }
    if (api) model.api = api
    if (baseUrl) model.baseUrl = baseUrl
    if (headers) model.headers = headers
    if (compat) model.compat = compat as never
    const candidateThinking = isJsonObject(candidate.thinkingLevelMap)
        ? candidate.thinkingLevelMap
        : undefined
    const overrideThinking = isJsonObject(override.thinkingLevelMap)
        ? override.thinkingLevelMap
        : undefined
    if (candidateThinking || overrideThinking) {
        model.thinkingLevelMap = {
            ...(candidateThinking ? structuredClone(candidateThinking) : {}),
            ...(overrideThinking ? structuredClone(overrideThinking) : {}),
        } as never
    }
    return model
}

/**
 * Convert one Host models.json provider into pi's public registration shape.
 * `baseModels` are supplied after unregistering a previous overlay so built-in
 * models and modelOverrides retain pi's normal composition semantics.
 */
function providerConfig(
    providerId: string,
    raw: JsonObject,
    baseModels: readonly PiModel[] = [],
): ProviderConfigInput {
    if (raw.oauth !== undefined && raw.oauth !== "radius") {
        throw new Error(`Provider ${providerId}: unsupported models.json OAuth value`)
    }
    if (raw.oauth === "radius" && providerId !== "radius") {
        throw new Error(
            `Provider ${providerId}: custom Radius OAuth providers cannot be registered from Host JSON`,
        )
    }
    const output: ProviderConfigInput = {}
    const name = requiredString(raw.name)
    const baseUrl = requiredString(raw.baseUrl)
    const api = requiredString(raw.api)
    const headers = stringRecord(raw.headers)
    if (name) output.name = name
    if (baseUrl) output.baseUrl = baseUrl
    if (api) output.api = api
    if (headers) output.headers = headers
    if (typeof raw.authHeader === "boolean") output.authHeader = raw.authHeader

    const definitions = new Map<string, { candidate: JsonObject; isBaseModel: boolean }>()
    for (const base of baseModels) {
        definitions.set(base.id, {candidate: modelAsJson(base), isBaseModel: true})
    }
    if (Array.isArray(raw.models)) {
        for (const candidate of raw.models) {
            if (!isJsonObject(candidate)) continue
            const id = requiredString(candidate.id)
            if (id) definitions.set(id, {candidate, isBaseModel: false})
        }
    }
    const overrides = isJsonObject(raw.modelOverrides) ? raw.modelOverrides : undefined
    if (overrides) {
        // Overrides for unknown ids are ignored by pi; only existing base/custom
        // models become registration entries.
        for (const id of Object.keys(overrides)) {
            if (definitions.has(id)) continue
            const base = baseModels.find((model) => model.id === id)
            if (base) definitions.set(id, {candidate: modelAsJson(base), isBaseModel: true})
        }
    }
    const hasModelOverlay = definitions.size > 0 && (
        baseModels.length > 0 || Array.isArray(raw.models) || Boolean(overrides && Object.keys(overrides).length)
    )
    if (hasModelOverlay) {
        output.models = [...definitions.values()]
            .map(({candidate, isBaseModel}) => buildModelDefinition(raw, candidate, isBaseModel))
            .filter((model): model is NonNullable<ProviderConfigInput["models"]>[number] => Boolean(model))
    }

    // models.json must never inject credentials into the runtime registration.
    return output
}

/** Read-only storage that exposes the already deep-merged Host snapshot to pi. */
export class HostBackedSettingsStorage implements SettingsStorage {
    #settingsJson = "{}"

    replace(settings: JsonObject): boolean {
        const next = JSON.stringify(settings)
        if (next === this.#settingsJson) return false
        this.#settingsJson = next
        return true
    }

    withLock(
        scope: "global" | "project",
        fn: (current: string | undefined) => string | undefined,
    ): void {
        // pi updates its in-memory SettingsManager before asking storage to persist.
        // Consume that write without retaining it so session-local controls keep
        // working while Host remains the only settings file writer.
        fn(scope === "global" ? this.#settingsJson : "{}")
    }
}

/** In-memory pi credential store whose only persistence path is Agent2Host.saveAuth. */
export class HostBackedCredentialStore implements CredentialStore {
    #credentials: CredentialMap = {}
    #revision = ""
    #stateVersion = 0
    #tail: Promise<void> = Promise.resolve()

    constructor(
        private readonly host: HostSettingsRpc,
        private readonly onPersisted?: (revision: string) => void,
    ) {
    }

    replace(authJson: string, revision: string): Promise<boolean> {
        const scheduledVersion = this.#stateVersion
        return this.#enqueue(async () => {
            if (this.#stateVersion !== scheduledVersion && this.#revision !== revision) {
                return this.#refetchApplication()
            }
            return this.#replaceNow(authJson, revision)
        })
    }

    async read(providerId: string): Promise<Credential | undefined> {
        return cloneCredential(asCredential(getCredential(this.#credentials, providerId)))
    }

    async list(): Promise<readonly CredentialInfo[]> {
        return Object.entries(this.#credentials).flatMap(([providerId, value]) => {
            const credential = asCredential(value)
            return credential ? [{providerId, type: credential.type}] : []
        })
    }

    modify(
        providerId: string,
        fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    ): Promise<Credential | undefined> {
        return this.#enqueue(async () => {
            for (let attempt = 0; attempt < 5; attempt += 1) {
                const current = asCredential(getCredential(this.#credentials, providerId))
                const next = await fn(cloneCredential(current))
                if (next === undefined) return cloneCredential(current)
                const candidate = setCredential(
                    this.#credentials,
                    providerId,
                    structuredClone(next) as unknown as JsonObject,
                )
                const saved = await this.#save(candidate)
                if (saved) return cloneCredential(next)
                await this.#refetchApplication()
            }
            throw new Error(`Credential update for ${providerId} did not converge after conflicts`)
        })
    }

    delete(providerId: string): Promise<void> {
        return this.#enqueue(async () => {
            for (let attempt = 0; attempt < 5; attempt += 1) {
                const candidate = deleteCredential(this.#credentials, providerId)
                if (fingerprint(candidate) === fingerprint(this.#credentials)) return
                if (await this.#save(candidate)) return
                await this.#refetchApplication()
            }
            throw new Error(`Credential deletion for ${providerId} did not converge after conflicts`)
        })
    }

    /** Serialize Host snapshot fetch/reconcile with pi login/refresh mutations. */
    runExclusive<T>(
        operation: (replace: (authJson: string, revision: string) => boolean) => Promise<T>,
    ): Promise<T> {
        return this.#enqueue(() => operation((authJson, revision) => this.#replaceNow(authJson, revision)))
    }

    #replaceNow(authJson: string, revision: string): boolean {
        const parsed = parseAuthJson(authJson).value
        const changed = fingerprint(parsed) !== fingerprint(this.#credentials)
        if (changed || revision !== this.#revision) this.#stateVersion += 1
        this.#credentials = parsed
        this.#revision = revision
        return changed
    }

    async #save(candidate: CredentialMap): Promise<boolean> {
        const authJson = credentialMapToJson(candidate)
        const result: SettingsSaveResult = await this.host.saveAuth({
            authJson,
            expectedRevision: this.#revision,
        })
        if (!result.ok) {
            if (result.conflict) return false
            throw new Error(result.error ?? "Host failed to save credentials")
        }
        this.#credentials = candidate
        this.#revision = result.revision
        this.#stateVersion += 1
        this.onPersisted?.(result.revision)
        return true
    }

    async #refetchApplication(): Promise<boolean> {
        const snapshot = normalizeAgentSettingsSnapshot(await this.host.getSettingsSnapshot("application"))
        if (snapshot.scope !== "application") {
            throw new Error("Host returned a project snapshot for application credentials")
        }
        return this.#replaceNow(snapshot.authJson, snapshot.revision)
    }

    #enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.#tail.then(operation, operation)
        this.#tail = result.then(() => undefined, () => undefined)
        return result
    }
}

export class HostSettingsController {
    readonly settingsStorage = new HostBackedSettingsStorage()
    readonly credentials: HostBackedCredentialStore
    readonly snapshots: SnapshotSettingsManager<AgentSettingsSnapshot>
    readonly #registeredModels = new Map<string, string>()
    #runtime?: HostModelRuntime
    #settingsFingerprint = ""
    #modelsFingerprint = ""
    #authFingerprint = ""
    #reconcileTail: Promise<void> = Promise.resolve()
    #reloadLiveSessions: (modelCatalogChanged: boolean) => Promise<void>

    constructor(
        private readonly host: HostSettingsRpc,
        private readonly options: HostSettingsControllerOptions,
    ) {
        const adapter: SettingsManagerAdapter<AgentSettingsSnapshot> = {
            getSettingsSnapshot: async (scope) =>
                normalizeAgentSettingsSnapshot(await host.getSettingsSnapshot(scope)),
        }
        this.snapshots = new SnapshotSettingsManager(adapter)
        this.#reloadLiveSessions = options.reloadLiveSessions ?? (async () => {
        })
        this.credentials = new HostBackedCredentialStore(
            host,
            (revision) => {
                // Saving auth also publishes a Host invalidation, but drive the same
                // revision through the normal refresh path as a fallback. The cache
                // deduplicates the real notification, so live sessions reload once.
                setImmediate(() => {
                    void this.handleSettingsChanged("application", null, revision).catch(() => {
                    })
                })
            },
        )
    }

    async initialize(): Promise<void> {
        await this.credentials.runExclusive(async (replaceCredentials) => {
            const effective = await this.snapshots.initialize(this.options.hasProject)
            const application = this.#applicationSnapshot()
            this.settingsStorage.replace(effective.settings)
            replaceCredentials(application.authJson, application.revision)
            this.#settingsFingerprint = fingerprint(effective.settings)
            this.#modelsFingerprint = fingerprint(parseModelsJson(application.modelsJson).value)
            this.#authFingerprint = fingerprint(parseAuthJson(application.authJson).value)
        })
    }

    setReloadLiveSessions(reload: (modelCatalogChanged: boolean) => Promise<void>): void {
        this.#reloadLiveSessions = reload
    }

    async attachModelRuntime(runtime: HostModelRuntime): Promise<void> {
        this.#runtime = runtime
        await this.#applyModels(this.#applicationSnapshot().modelsJson)
    }

    handleSettingsChanged(
        scope: string,
        projectRoot: string | null,
        revision: string,
    ): Promise<void> {
        if (scope !== "application" && scope !== "project") {
            return Promise.reject(new Error(`Unknown settings scope: ${scope}`))
        }
        const change: SettingsChanged = {scope, projectRoot, revision}
        return this.#enqueue(async () => {
            await this.credentials.runExclusive(async (replaceCredentials) => {
                await this.snapshots.handleSettingsChanged(change)
                await this.#reconcile(replaceCredentials, scope === "application")
            })
        })
    }

    /** Re-read both Host scopes after the control service starts accepting notifications. */
    refreshFromHost(): Promise<void> {
        return this.#enqueue(async () => {
            await this.credentials.runExclusive(async (replaceCredentials) => {
                await this.snapshots.initialize(this.options.hasProject)
                await this.#reconcile(replaceCredentials, true)
            })
        })
    }

    getApplicationSnapshot(): AgentApplicationSettingsSnapshot {
        return structuredClone(this.#applicationSnapshot())
    }

    applyCommitSettings(request: GenerateCommitMessageRequest): GenerateCommitMessageRequest {
        const effective = this.snapshots.getEffectiveSettings()
        if (!effective) throw new Error("Effective Host settings are unavailable")
        return applyEffectiveCommitSettings(request, effective)
    }

    #enqueue(operation: () => Promise<void>): Promise<void> {
        const result = this.#reconcileTail.then(operation, operation)
        this.#reconcileTail = result.catch((error) => {
            log.warn("host settings reconciliation failed", {err: error})
        })
        return result
    }

    async #reconcile(
        replaceCredentials: (authJson: string, revision: string) => boolean,
        replaceApplicationCredentials: boolean,
    ): Promise<void> {
        const application = this.#applicationSnapshot()
        const effective = this.snapshots.getEffectiveSettings()
        if (!effective) throw new Error("Effective Host settings are unavailable")

        const settingsFingerprint = fingerprint(effective.settings)
        const modelsFingerprint = fingerprint(parseModelsJson(application.modelsJson).value)
        const authFingerprint = fingerprint(parseAuthJson(application.authJson).value)
        const settingsChanged = settingsFingerprint !== this.#settingsFingerprint
        const modelsChanged = modelsFingerprint !== this.#modelsFingerprint
        const authChanged = authFingerprint !== this.#authFingerprint

        this.#settingsFingerprint = settingsFingerprint
        this.#modelsFingerprint = modelsFingerprint
        this.#authFingerprint = authFingerprint
        this.settingsStorage.replace(effective.settings)
        if (replaceApplicationCredentials) {
            replaceCredentials(application.authJson, application.revision)
        }

        if (modelsChanged) await this.#applyModels(application.modelsJson)
        else if (authChanged) await this.#runtime?.refresh({allowNetwork: false})

        if (settingsChanged || modelsChanged || authChanged) {
            await this.#reloadLiveSessions(modelsChanged || authChanged)
            log.info("host settings applied", {
                scopeRevision: effective.revision,
                settingsChanged,
                modelsChanged,
                authChanged,
            })
        }
    }

    async #applyModels(modelsJson: string): Promise<void> {
        const runtime = this.#runtime
        if (!runtime) return
        const providers = parseModelsJson(modelsJson).value.providers ?? {}
        const nextFingerprints = new Map(
            Object.entries(providers).map(([providerId, config]) => [
                providerId,
                fingerprint(config),
            ]),
        )

        for (const providerId of this.#registeredModels.keys()) {
            if (!nextFingerprints.has(providerId)) {
                runtime.unregisterProvider(providerId)
                this.#registeredModels.delete(providerId)
            }
        }

        for (const [providerId, raw] of Object.entries(providers)) {
            const next = nextFingerprints.get(providerId)!
            if (this.#registeredModels.get(providerId) === next) continue
            if (this.#registeredModels.has(providerId)) runtime.unregisterProvider(providerId)
            try {
                // Unregister first so getModels() exposes the builtin base list rather
                // than a previous Host overlay when a provider is being replaced.
                const baseModels = runtime.getModels(providerId)
                runtime.registerProvider(providerId, providerConfig(providerId, raw, baseModels))
                this.#registeredModels.set(providerId, next)
            } catch (error) {
                this.#registeredModels.delete(providerId)
                log.warn("host model provider rejected", {providerId, err: error})
            }
        }
        await runtime.refresh({allowNetwork: false})
    }

    #applicationSnapshot(): AgentApplicationSettingsSnapshot {
        const snapshot = this.snapshots.getSnapshot("application")
        if (!snapshot) throw new Error("Application Host settings are unavailable")
        return snapshot
    }
}
