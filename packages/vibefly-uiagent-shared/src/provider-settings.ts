/**
 * Agent-only models.json / auth.json projection and patch helpers.
 * Host remains the sole writer; these functions never touch the filesystem.
 */
import {cloneJsonValue, hasOwn, isJsonObject, type JsonObject, type JsonValue} from "./json.js"

const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_TOKENS = 16_384
const DEFAULT_COST: JsonObject = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
}

export type ProviderCredentialOrigin = "api_key" | "oauth" | "none"

export type ProviderCredentialStatus = {
    hasApiKey: boolean
    hasOAuth: boolean
    originKind: ProviderCredentialOrigin
}

export type ProviderRuntimeSnapshot = {
    id: string
    configJson: string | null
    credential: ProviderCredentialStatus
}

export type ProvidersSnapshot = {
    providers: ProviderRuntimeSnapshot[]
}

export type ProviderPatch = {
    id: string
    remove?: boolean
    configJson?: string | null
}

export type ProvidersPatchRequest = {
    providers?: readonly ProviderPatch[]
}

export type ProviderApiKeyMutation = {
    providerId: string
    apiKey: string
}

export type CustomProviderMutation = {
    id: string
    remove?: boolean
    configJson?: string | null
    apiKey?: string | null
}

export type PatchedModelsDocument = {
    modelsJson: string
    modelsChanged: boolean
}

export type PatchedAuthDocument = {
    authJson: string
    authChanged: boolean
}

export type PatchedProviderDocuments = {
    modelsJson: string
    authJson: string
    modelsChanged: boolean
    authChanged: boolean
    snapshot: ProvidersSnapshot
}

/** Stable domain error when a user tries to overwrite an OAuth session with an API key. */
export const OAUTH_API_KEY_CONFLICT_ERROR =
    "Disconnect this provider before setting an API key"

/**
 * Project a WebView-safe provider snapshot from authoritative Host documents.
 * auth.json secrets stay out of the projection; models.json apiKey is retained.
 */
export function snapshotProviders(modelsJson: string, authJson: string): ProvidersSnapshot {
    const modelsRoot = parseRequiredObject(modelsJson, "models.json")
    const authRoot = parseRequiredObject(authJson, "auth.json")
    const configured = providerEntries(modelsRoot)
    const providerIds = [...new Set([...Object.keys(configured), ...Object.keys(authRoot)])]
        .sort((left, right) => left.localeCompare(right))
    return {
        providers: providerIds.map((providerId) => {
            const entry = configured[providerId]
            return {
                id: providerId,
                configJson: isJsonObject(entry) ? JSON.stringify(entry) : null,
                credential: credentialStatus(authRoot[providerId]),
            }
        }),
    }
}

/**
 * Apply a wholesale provider-entry patch to models.json only.
 * Empty patches keep the source document byte-identical.
 */
export function applyProviderConfigPatch(
    modelsJson: string,
    request: ProvidersPatchRequest,
): PatchedModelsDocument {
    const originalModelsRoot = parseRequiredObject(modelsJson, "models.json")
    const modelsRoot = cloneJsonValue(originalModelsRoot)
    const providerPatches = request.providers ?? []

    const providers = isJsonObject(modelsRoot.providers)
        ? cloneJsonValue(modelsRoot.providers)
        : {}
    for (const patch of providerPatches) applyProviderPatch(providers, patch)

    // Do not synthesize `providers: {}` when the source omitted that key.
    if (providerPatches.length > 0) {
        modelsRoot.providers = providers
    }

    const modelsChanged = !jsonValuesEqual(modelsRoot, originalModelsRoot)
    const nextModelsJson = modelsChanged ? encodePretty(modelsRoot) : modelsJson
    return {
        modelsJson: nextModelsJson,
        modelsChanged,
    }
}

/**
 * Set or replace an API-key credential. Refuses to overwrite an OAuth session.
 * Empty/whitespace keys are a no-op. Unknown fields on an existing api_key are kept.
 */
export function applyProviderApiKey(
    authJson: string,
    mutation: ProviderApiKeyMutation,
): PatchedAuthDocument {
    const originalAuthRoot = parseRequiredObject(authJson, "auth.json")
    const authRoot = cloneJsonValue(originalAuthRoot)
    applyApiKeyMutation(authRoot, mutation)
    const authChanged = !jsonValuesEqual(authRoot, originalAuthRoot)
    return {
        authJson: authChanged ? encodePretty(authRoot) : authJson,
        authChanged,
    }
}

/**
 * Atomically transform models.json and auth.json for one custom provider.
 * Save with a blank apiKey leaves auth.json byte-identical. Delete removes any credential type.
 */
export function mutateCustomProviderDocuments(
    modelsJson: string,
    authJson: string,
    request: CustomProviderMutation,
): PatchedProviderDocuments {
    const providerId = request.id.trim()
    if (!providerId) throw new Error("Provider id is required")

    const originalModelsRoot = parseRequiredObject(modelsJson, "models.json")
    const originalAuthRoot = parseRequiredObject(authJson, "auth.json")
    const modelsRoot = cloneJsonValue(originalModelsRoot)
    const authRoot = cloneJsonValue(originalAuthRoot)

    const providers = isJsonObject(modelsRoot.providers)
        ? cloneJsonValue(modelsRoot.providers)
        : {}
    applyProviderPatch(providers, {
        id: providerId,
        remove: request.remove,
        configJson: request.configJson,
    })
    modelsRoot.providers = providers

    if (request.remove) {
        delete authRoot[providerId]
    } else {
        const apiKey = request.apiKey?.trim() ?? ""
        if (apiKey) applyApiKeyMutation(authRoot, {providerId, apiKey})
    }

    const modelsChanged = !jsonValuesEqual(modelsRoot, originalModelsRoot)
    const authChanged = !jsonValuesEqual(authRoot, originalAuthRoot)
    const nextModelsJson = modelsChanged ? encodePretty(modelsRoot) : modelsJson
    const nextAuthJson = authChanged ? encodePretty(authRoot) : authJson
    return {
        modelsJson: nextModelsJson,
        authJson: nextAuthJson,
        modelsChanged,
        authChanged,
        snapshot: snapshotProviders(nextModelsJson, nextAuthJson),
    }
}

function applyProviderPatch(providers: JsonObject, patch: ProviderPatch): void {
    const providerId = patch.id.trim()
    if (!providerId) throw new Error("Provider id is required")
    if (patch.remove) {
        delete providers[providerId]
        return
    }

    const rawConfig = patch.configJson?.trim() ?? ""
    if (!rawConfig) throw new Error(`Provider ${providerId}: configJson is required`)

    let parsed: unknown
    try {
        parsed = JSON.parse(rawConfig)
    } catch {
        throw new Error(`Provider ${providerId}: configJson must be a JSON object`)
    }
    if (!isJsonObject(parsed)) {
        throw new Error(`Provider ${providerId}: configJson must be a JSON object`)
    }
    if (hasOwn(parsed, "providers")) {
        throw new Error(
            `Provider ${providerId}: configJson must be a single provider entry, not a providers map`,
        )
    }
    providers[providerId] = validateProviderEntry(providerId, parsed)
}

function validateProviderEntry(providerId: string, entry: JsonObject): JsonObject {
    const values = cloneJsonValue(entry)
    if (values.models !== undefined) {
        if (!Array.isArray(values.models)) {
            throw new Error(`Provider ${providerId}: models must be an array`)
        }
        const seenIds = new Set<string>()
        values.models = values.models.map((raw, index) => {
            if (!isJsonObject(raw)) {
                throw new Error(`Provider ${providerId}: models[${index}] must be an object`)
            }
            return validateModel(providerId, index, raw, seenIds)
        })
    }

    validateOptionalString(values, "baseUrl", providerId)
    validateOptionalString(values, "api", providerId)
    validateOptionalString(values, "name", providerId)
    validateOptionalString(values, "apiKey", providerId)
    validateOptionalBoolean(values, "authHeader", providerId)
    validateOptionalObject(values, "headers", providerId)
    validateOptionalObject(values, "compat", providerId)
    validateOptionalObject(values, "modelOverrides", providerId)

    const models = Array.isArray(values.models) ? values.models : undefined
    if (models && models.length > 0) {
        const providerBaseUrl = objectString(values, "baseUrl")
        const providerApi = objectString(values, "api")
        const allModelsHaveBaseUrl = models.every(
            (model) => isJsonObject(model) && objectString(model, "baseUrl") != null,
        )
        const allModelsHaveApi = models.every(
            (model) => isJsonObject(model) && objectString(model, "api") != null,
        )
        if (providerBaseUrl == null && !allModelsHaveBaseUrl) {
            throw new Error(`Provider ${providerId}: baseUrl is required when defining custom models`)
        }
        if (providerApi == null && !allModelsHaveApi) {
            throw new Error(
                `Provider ${providerId}: api is required at provider or model level for custom models`,
            )
        }
    }
    return values
}

function validateModel(
    providerId: string,
    index: number,
    model: JsonObject,
    seenIds: Set<string>,
): JsonObject {
    const values = cloneJsonValue(model)
    const modelId = objectString(values, "id")
    if (modelId == null) {
        throw new Error(`Provider ${providerId}: models[${index}].id is required`)
    }
    if (seenIds.has(modelId)) {
        throw new Error(`Provider ${providerId}: duplicate model id "${modelId}"`)
    }
    seenIds.add(modelId)

    if (values.name === undefined) {
        values.name = modelId
    } else {
        validateOptionalString(values, "name", `${providerId} models[${index}]`)
    }
    validateOptionalString(values, "api", `${providerId} models[${index}]`)
    validateOptionalString(values, "baseUrl", `${providerId} models[${index}]`)
    validateOptionalBoolean(values, "reasoning", `${providerId} models[${index}]`)
    validateOptionalObject(values, "headers", `${providerId} models[${index}]`)
    validateOptionalObject(values, "compat", `${providerId} models[${index}]`)
    validateOptionalObject(values, "thinkingLevelMap", `${providerId} models[${index}]`)

    if (values.input === undefined) {
        values.input = ["text"]
    } else if (Array.isArray(values.input)) {
        if (!values.input.every((item) => typeof item === "string")) {
            throw new Error(`Provider ${providerId}: models[${index}].input must be an array of strings`)
        }
    } else {
        throw new Error(`Provider ${providerId}: models[${index}].input must be an array of strings`)
    }

    if (values.cost === undefined) {
        values.cost = cloneJsonValue(DEFAULT_COST)
    } else if (isJsonObject(values.cost)) {
        validateCost(providerId, index, values.cost)
    } else {
        throw new Error(`Provider ${providerId}: models[${index}].cost must be an object`)
    }

    if (values.contextWindow === undefined) {
        values.contextWindow = DEFAULT_CONTEXT_WINDOW
    } else if (!isJsonNumber(values.contextWindow)) {
        throw new Error(`Provider ${providerId}: models[${index}].contextWindow must be a number`)
    }

    if (values.maxTokens === undefined) {
        values.maxTokens = DEFAULT_MAX_TOKENS
    } else if (!isJsonNumber(values.maxTokens)) {
        throw new Error(`Provider ${providerId}: models[${index}].maxTokens must be a number`)
    }

    return values
}

function validateCost(providerId: string, index: number, cost: JsonObject): void {
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
        const value = cost[key]
        if (value === undefined) continue
        if (!isJsonNumber(value)) {
            throw new Error(`Provider ${providerId}: models[${index}].cost.${key} must be a number`)
        }
    }
    if (cost.tiers !== undefined && !Array.isArray(cost.tiers)) {
        throw new Error(`Provider ${providerId}: models[${index}].cost.tiers must be an array`)
    }
}

function applyApiKeyMutation(auth: JsonObject, mutation: ProviderApiKeyMutation): void {
    const providerId = mutation.providerId.trim()
    if (!providerId) throw new Error("Credential provider is required")
    const apiKey = mutation.apiKey.trim()
    if (!apiKey) return
    const current = auth[providerId]
    auth[providerId] = nextApiKeyCredential(
        isJsonObject(current) ? current : undefined,
        apiKey,
    )
}

export function nextApiKeyCredential(
    current: JsonObject | undefined,
    apiKey: string,
): JsonObject {
    if (current && objectString(current, "type") === "oauth") {
        throw new Error(OAUTH_API_KEY_CONFLICT_ERROR)
    }
    const existingApiKey = current != null && objectString(current, "type") === "api_key"
        ? current
        : undefined
    const values = existingApiKey ? cloneJsonValue(existingApiKey) : {}
    values.type = "api_key"
    values.key = apiKey
    return values
}

function credentialStatus(raw: JsonValue | undefined): ProviderCredentialStatus {
    const type = isJsonObject(raw) ? objectString(raw, "type") : undefined
    const hasApiKey = type === "api_key"
    const hasOAuth = type === "oauth"
    return {
        hasApiKey,
        hasOAuth,
        originKind: hasOAuth ? "oauth" : hasApiKey ? "api_key" : "none",
    }
}

function providerEntries(modelsRoot: JsonObject): JsonObject {
    return isJsonObject(modelsRoot.providers) ? modelsRoot.providers : {}
}

function parseRequiredObject(raw: string, fileName: string): JsonObject {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw new Error(`${fileName} must contain a JSON object`)
    }
    if (!isJsonObject(parsed)) {
        throw new Error(`${fileName} must contain a JSON object`)
    }
    return cloneJsonValue(parsed)
}

function validateOptionalString(values: JsonObject, key: string, context: string): void {
    const value = values[key]
    if (value === undefined) return
    if (typeof value !== "string") throw new Error(`${context}: ${key} must be a string`)
}

function validateOptionalBoolean(values: JsonObject, key: string, context: string): void {
    const value = values[key]
    if (value === undefined) return
    if (typeof value !== "boolean") throw new Error(`${context}: ${key} must be a boolean`)
}

function validateOptionalObject(values: JsonObject, key: string, context: string): void {
    const value = values[key]
    if (value === undefined) return
    if (!isJsonObject(value)) throw new Error(`${context}: ${key} must be an object`)
}

function objectString(values: JsonObject, key: string): string | undefined {
    const value = values[key]
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed || undefined
}

function isJsonNumber(value: JsonValue): value is number {
    return typeof value === "number" && Number.isFinite(value)
}

function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
    if (left === right) return true
    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) return false
        return left.every((item, index) => jsonValuesEqual(item, right[index]!))
    }
    if (isJsonObject(left) && isJsonObject(right)) {
        const leftKeys = Object.keys(left)
        const rightKeys = Object.keys(right)
        if (leftKeys.length !== rightKeys.length) return false
        return leftKeys.every((key) => hasOwn(right, key) && jsonValuesEqual(left[key]!, right[key]!))
    }
    return false
}

function encodePretty(value: JsonObject): string {
    return `${JSON.stringify(value, null, 2)}\n`
}
