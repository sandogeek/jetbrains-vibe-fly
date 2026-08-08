/** Full Provider entry draft: Basic form state ↔ Advanced JSON. */

export const API_PRESETS = [
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generative-ai",
] as const

export type ModelConfigDraft = {
    id: string
    name: string
    api: string
    baseUrl: string
    reasoning: boolean
    input: string[]
    contextWindow: number
    maxTokens: number
    cost: {
        input: number
        output: number
        cacheRead: number
        cacheWrite: number
        tiers?: unknown
    }
    headers: Record<string, string>
    compat: Record<string, unknown> | null
    thinkingLevelMap: Record<string, unknown> | null
    /** Unknown model-level fields preserved on round-trip. */
    extra: Record<string, unknown>
}

export type ProviderConfigDraft = {
    baseUrl: string
    api: string
    authHeader: boolean | null
    headers: Record<string, string>
    compat: Record<string, unknown> | null
    models: ModelConfigDraft[]
    /** Unknown provider-level fields (including apiKey, modelOverrides, name, …). */
    extra: Record<string, unknown>
}

const KNOWN_PROVIDER_KEYS = new Set([
    "baseUrl",
    "api",
    "authHeader",
    "headers",
    "compat",
    "models",
])

const KNOWN_MODEL_KEYS = new Set([
    "id",
    "name",
    "api",
    "baseUrl",
    "reasoning",
    "input",
    "contextWindow",
    "maxTokens",
    "cost",
    "headers",
    "compat",
    "thinkingLevelMap",
])

export function emptyModelDraft(id = ""): ModelConfigDraft {
    return {
        id,
        name: id,
        api: "",
        baseUrl: "",
        reasoning: false,
        input: ["text"],
        contextWindow: 128_000,
        maxTokens: 16_384,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
        headers: {},
        compat: null,
        thinkingLevelMap: null,
        extra: {},
    }
}

export function emptyProviderDraft(): ProviderConfigDraft {
    return {
        baseUrl: "",
        api: "openai-completions",
        authHeader: null,
        headers: {},
        compat: null,
        models: [],
        extra: {},
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === "object" && !Array.isArray(value)
}

function stringField(value: unknown): string {
    return typeof value === "string" ? value : ""
}

function numberField(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function stringRecord(value: unknown): Record<string, string> {
    if (!isPlainObject(value)) return {}
    const out: Record<string, string> = {}
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === "string") out[key] = entry
    }
    return out
}

function parseModel(raw: unknown): ModelConfigDraft | null {
    if (!isPlainObject(raw)) return null
    const id = stringField(raw.id).trim()
    if (!id) return null
    const input = Array.isArray(raw.input)
        ? raw.input.filter((item): item is string => typeof item === "string")
        : ["text"]
    const costRaw = isPlainObject(raw.cost) ? raw.cost : {}
    const cost: ModelConfigDraft["cost"] = {
        input: numberField(costRaw.input, 0),
        output: numberField(costRaw.output, 0),
        cacheRead: numberField(costRaw.cacheRead, 0),
        cacheWrite: numberField(costRaw.cacheWrite, 0),
    }
    if (Array.isArray(costRaw.tiers)) cost.tiers = structuredClone(costRaw.tiers)

    const extra: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(raw)) {
        if (!KNOWN_MODEL_KEYS.has(key)) extra[key] = structuredClone(value)
    }

    return {
        id,
        name: stringField(raw.name).trim() || id,
        api: stringField(raw.api).trim(),
        baseUrl: stringField(raw.baseUrl).trim(),
        reasoning: typeof raw.reasoning === "boolean" ? raw.reasoning : false,
        input: input.length > 0 ? input : ["text"],
        contextWindow: numberField(raw.contextWindow, 128_000),
        maxTokens: numberField(raw.maxTokens, 16_384),
        cost,
        headers: stringRecord(raw.headers),
        compat: isPlainObject(raw.compat) ? structuredClone(raw.compat) : null,
        thinkingLevelMap: isPlainObject(raw.thinkingLevelMap)
            ? structuredClone(raw.thinkingLevelMap)
            : null,
        extra,
    }
}

export function draftFromConfigJson(configJson: string | null | undefined): ProviderConfigDraft {
    if (!configJson?.trim()) return emptyProviderDraft()
    let parsed: unknown
    try {
        parsed = JSON.parse(configJson)
    } catch {
        return emptyProviderDraft()
    }
    if (!isPlainObject(parsed)) return emptyProviderDraft()

    const models = Array.isArray(parsed.models)
        ? parsed.models.map(parseModel).filter((model): model is ModelConfigDraft => model != null)
        : []

    const extra: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parsed)) {
        if (!KNOWN_PROVIDER_KEYS.has(key)) extra[key] = structuredClone(value)
    }

    return {
        baseUrl: stringField(parsed.baseUrl).trim(),
        api: stringField(parsed.api).trim() || "openai-completions",
        authHeader: typeof parsed.authHeader === "boolean" ? parsed.authHeader : null,
        headers: stringRecord(parsed.headers),
        compat: isPlainObject(parsed.compat) ? structuredClone(parsed.compat) : null,
        models,
        extra,
    }
}

function omitEmptyString(value: string): string | undefined {
    const trimmed = value.trim()
    return trimmed ? trimmed : undefined
}

function headersOrUndefined(headers: Record<string, string>): Record<string, string> | undefined {
    return Object.keys(headers).length > 0 ? {...headers} : undefined
}

export function draftToObject(draft: ProviderConfigDraft): Record<string, unknown> {
    const out: Record<string, unknown> = {...structuredClone(draft.extra)}
    const baseUrl = omitEmptyString(draft.baseUrl)
    const api = omitEmptyString(draft.api)
    if (baseUrl) out.baseUrl = baseUrl
    else delete out.baseUrl
    if (api) out.api = api
    else delete out.api
    if (draft.authHeader != null) out.authHeader = draft.authHeader
    else delete out.authHeader
    const headers = headersOrUndefined(draft.headers)
    if (headers) out.headers = headers
    else delete out.headers
    if (draft.compat && Object.keys(draft.compat).length > 0) out.compat = structuredClone(draft.compat)
    else delete out.compat

    out.models = draft.models.map((model) => {
        const entry: Record<string, unknown> = {...structuredClone(model.extra)}
        entry.id = model.id.trim()
        entry.name = model.name.trim() || model.id.trim()
        const modelApi = omitEmptyString(model.api)
        const modelBaseUrl = omitEmptyString(model.baseUrl)
        if (modelApi) entry.api = modelApi
        else delete entry.api
        if (modelBaseUrl) entry.baseUrl = modelBaseUrl
        else delete entry.baseUrl
        entry.reasoning = model.reasoning
        entry.input = model.input.length > 0 ? [...model.input] : ["text"]
        entry.contextWindow = model.contextWindow
        entry.maxTokens = model.maxTokens
        entry.cost = {
            input: model.cost.input,
            output: model.cost.output,
            cacheRead: model.cost.cacheRead,
            cacheWrite: model.cost.cacheWrite,
            ...(model.cost.tiers != null ? {tiers: structuredClone(model.cost.tiers)} : {}),
        }
        const modelHeaders = headersOrUndefined(model.headers)
        if (modelHeaders) entry.headers = modelHeaders
        else delete entry.headers
        if (model.compat && Object.keys(model.compat).length > 0) {
            entry.compat = structuredClone(model.compat)
        } else delete entry.compat
        if (model.thinkingLevelMap && Object.keys(model.thinkingLevelMap).length > 0) {
            entry.thinkingLevelMap = structuredClone(model.thinkingLevelMap)
        } else delete entry.thinkingLevelMap
        return entry
    })
    return out
}

export function draftToConfigJson(draft: ProviderConfigDraft): string {
    return JSON.stringify(draftToObject(draft), null, 2)
}

export function formatConfigJson(configJson: string | null | undefined): string {
    if (!configJson?.trim()) return draftToConfigJson(emptyProviderDraft())
    try {
        return JSON.stringify(JSON.parse(configJson), null, 2)
    } catch {
        return configJson
    }
}

export type ConfigJsonValidation =
    | { ok: true; configJson: string }
    | { ok: false; error: string }

export function validateConfigJson(raw: string): ConfigJsonValidation {
    const text = raw.trim()
    if (!text) return {ok: false, error: "Provider config JSON is required"}
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch (error) {
        return {ok: false, error: error instanceof Error ? error.message : "Invalid JSON"}
    }
    if (!isPlainObject(parsed)) return {ok: false, error: "Provider config must be a JSON object"}
    if ("providers" in parsed) {
        return {ok: false, error: "Provide a single provider entry, not a providers map"}
    }

    const models = parsed.models
    if (models != null) {
        if (!Array.isArray(models)) return {ok: false, error: "models must be an array"}
        const seen = new Set<string>()
        for (let i = 0; i < models.length; i += 1) {
            const model = models[i]
            if (!isPlainObject(model)) return {ok: false, error: `models[${i}] must be an object`}
            const id = typeof model.id === "string" ? model.id.trim() : ""
            if (!id) return {ok: false, error: `models[${i}].id is required`}
            if (seen.has(id)) return {ok: false, error: `Duplicate model id "${id}"`}
            seen.add(id)
            if (model.contextWindow != null && typeof model.contextWindow !== "number") {
                return {ok: false, error: `models[${i}].contextWindow must be a number`}
            }
            if (model.maxTokens != null && typeof model.maxTokens !== "number") {
                return {ok: false, error: `models[${i}].maxTokens must be a number`}
            }
            if (model.input != null && !Array.isArray(model.input)) {
                return {ok: false, error: `models[${i}].input must be an array`}
            }
            if (model.cost != null && !isPlainObject(model.cost)) {
                return {ok: false, error: `models[${i}].cost must be an object`}
            }
        }
        if (models.length > 0) {
            const providerBaseUrl = typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : ""
            const providerApi = typeof parsed.api === "string" ? parsed.api.trim() : ""
            const allHaveBase = models.every(
                (m) => isPlainObject(m) && typeof m.baseUrl === "string" && m.baseUrl.trim(),
            )
            const allHaveApi = models.every(
                (m) => isPlainObject(m) && typeof m.api === "string" && m.api.trim(),
            )
            if (!providerBaseUrl && !allHaveBase) {
                return {ok: false, error: "baseUrl is required when defining custom models"}
            }
            if (!providerApi && !allHaveApi) {
                return {ok: false, error: "api is required at provider or model level for custom models"}
            }
        }
    }
    return {ok: true, configJson: JSON.stringify(parsed)}
}

export type ParsedProviderModel = {
    id: string
    name: string | null
    api: string | null
}

/** Extract model list from a provider configJson for pickers / list views. */
export function modelsFromConfigJson(configJson: string | null | undefined): ParsedProviderModel[] {
    if (!configJson?.trim()) return []
    try {
        const parsed = JSON.parse(configJson) as unknown
        if (!isPlainObject(parsed) || !Array.isArray(parsed.models)) return []
        const out: ParsedProviderModel[] = []
        for (const raw of parsed.models) {
            if (!isPlainObject(raw)) continue
            const id = typeof raw.id === "string" ? raw.id.trim() : ""
            if (!id) continue
            out.push({
                id,
                name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id,
                api: typeof raw.api === "string" && raw.api.trim() ? raw.api.trim() : null,
            })
        }
        return out
    } catch {
        return []
    }
}

export function providerFieldFromConfigJson(
    configJson: string | null | undefined,
    field: "baseUrl" | "api",
): string | null {
    if (!configJson?.trim()) return null
    try {
        const parsed = JSON.parse(configJson) as unknown
        if (!isPlainObject(parsed)) return null
        const value = parsed[field]
        return typeof value === "string" && value.trim() ? value.trim() : null
    } catch {
        return null
    }
}

export function duplicateModel(model: ModelConfigDraft): ModelConfigDraft {
    const copy = structuredClone(model)
    copy.id = copy.id ? `${copy.id}-copy` : "model-copy"
    copy.name = copy.name ? `${copy.name} (copy)` : copy.id
    return copy
}
