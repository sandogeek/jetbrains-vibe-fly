import {
    cloneJsonValue,
    isJsonObject,
    type JsonObject,
    parseJsonObjectDocument,
    type SafeApplicationSettingsSnapshot,
    type SafeProjectSettingsSnapshot,
    type SettingsDiagnostic,
    type SettingsValidationResult,
    updateJsonAtPath,
} from "./settings/schema.js"

export type AgentApplicationSettingsSnapshot = SafeApplicationSettingsSnapshot & {
    modelsJson: string
    authJson: string
}

export type AgentProjectSettingsSnapshot = SafeProjectSettingsSnapshot

export type AgentSettingsSnapshot =
    | AgentApplicationSettingsSnapshot
    | AgentProjectSettingsSnapshot

/** Wire / RPC-shaped input before domain normalization. */
export type LooseAgentSettingsSnapshot = {
    scope: string
    projectRoot?: string | null
    settingsJson?: string | null
    vibeflyJson?: string | null
    modelsJson?: string | null
    authJson?: string | null
    revision: string
    diagnostics?: Array<{
        file: string
        severity: string
        message: string
    }> | null
}

export type ModelsSettings = JsonObject & {
    providers?: Record<string, JsonObject>
}

export type CredentialMap = Record<string, JsonObject>

const SETTINGS_FILES = new Set([
    "settings.json",
    "settings.vibefly.json",
    "models.json",
    "auth.json",
])

function invalidEntry(
    file: "models.json" | "auth.json",
    path: string,
): SettingsDiagnostic {
    return {
        file,
        severity: "error",
        message: `${path} must be an object`,
    }
}

function safeDiagnostics(
    raw: LooseAgentSettingsSnapshot["diagnostics"],
): SettingsDiagnostic[] {
    const diagnostics: SettingsDiagnostic[] = []
    for (const item of raw ?? []) {
        if (!SETTINGS_FILES.has(item.file)) continue
        if (item.severity !== "error" && item.severity !== "warning") continue
        diagnostics.push({
            file: item.file as SettingsDiagnostic["file"],
            severity: item.severity,
            message: String(item.message),
        })
    }
    return diagnostics
}

/** Normalize Host wire snapshot into the agent domain shape. */
export function normalizeAgentSettingsSnapshot(
    raw: LooseAgentSettingsSnapshot,
): AgentSettingsSnapshot {
    const common = {
        settingsJson: raw.settingsJson ?? "{}",
        vibeflyJson: raw.vibeflyJson ?? "{}",
        revision: String(raw.revision),
        diagnostics: safeDiagnostics(raw.diagnostics),
    }
    if (raw.scope === "application") {
        if (raw.projectRoot != null) {
            throw new Error("Application settings snapshot must have a null projectRoot")
        }
        return {
            ...common,
            scope: "application",
            projectRoot: null,
            modelsJson: raw.modelsJson ?? "{}",
            authJson: raw.authJson ?? "{}",
        }
    }
    if (raw.scope === "project") {
        const projectRoot = raw.projectRoot?.trim()
        if (!projectRoot) throw new Error("Project settings snapshot must have a projectRoot")
        return {
            ...common,
            scope: "project",
            projectRoot,
        }
    }
    throw new Error(`Unknown settings scope: ${raw.scope}`)
}

export function parseModelsJson(source: string): SettingsValidationResult<ModelsSettings> {
    const parsed = parseJsonObjectDocument(source, "models.json")
    const providers = parsed.value.providers
    if (providers === undefined) {
        return {value: parsed.value as ModelsSettings, diagnostics: parsed.diagnostics}
    }
    if (!isJsonObject(providers)) {
        delete parsed.value.providers
        parsed.diagnostics.push(invalidEntry("models.json", "$.providers"))
        return {value: parsed.value as ModelsSettings, diagnostics: parsed.diagnostics}
    }

    for (const [providerId, provider] of Object.entries(providers)) {
        if (isJsonObject(provider)) continue
        delete providers[providerId]
        parsed.diagnostics.push(
            invalidEntry("models.json", `$.providers[${JSON.stringify(providerId)}]`),
        )
    }
    return {value: parsed.value as ModelsSettings, diagnostics: parsed.diagnostics}
}

export function parseAuthJson(source: string): SettingsValidationResult<CredentialMap> {
    const parsed = parseJsonObjectDocument(source, "auth.json")
    for (const [providerId, credential] of Object.entries(parsed.value)) {
        if (isJsonObject(credential)) continue
        delete parsed.value[providerId]
        parsed.diagnostics.push(
            invalidEntry("auth.json", `$[${JSON.stringify(providerId)}]`),
        )
    }
    return {value: parsed.value as CredentialMap, diagnostics: parsed.diagnostics}
}

export function getCredential(
    credentials: CredentialMap,
    providerId: string,
): JsonObject | undefined {
    if (!Object.prototype.hasOwnProperty.call(credentials, providerId)) return undefined
    const credential = credentials[providerId]
    return isJsonObject(credential) ? cloneJsonValue(credential) : undefined
}

export function updateCredential(
    credentials: CredentialMap,
    providerId: string,
    updater: (current: JsonObject | undefined) => JsonObject | undefined,
): CredentialMap {
    if (!providerId.trim()) throw new Error("Credential provider id must not be empty")
    return updateJsonAtPath(credentials, [providerId], (current) => {
        const currentCredential = isJsonObject(current) ? current : undefined
        return updater(currentCredential ? cloneJsonValue(currentCredential) : undefined)
    }) as CredentialMap
}

export function setCredential(
    credentials: CredentialMap,
    providerId: string,
    credential: JsonObject,
): CredentialMap {
    return updateCredential(credentials, providerId, () => credential)
}

export function deleteCredential(
    credentials: CredentialMap,
    providerId: string,
): CredentialMap {
    return updateCredential(credentials, providerId, () => undefined)
}

export {
    applyProviderApiKey,
    applyProviderConfigPatch,
    mutateCustomProviderDocuments,
    nextApiKeyCredential,
    OAUTH_API_KEY_CONFLICT_ERROR,
    snapshotProviders,
} from "./provider-settings.js"
export type {
    CustomProviderMutation,
    PatchedProviderDocuments,
    PatchedAuthDocument,
    PatchedModelsDocument,
    ProviderApiKeyMutation,
    ProviderCredentialOrigin,
    ProviderCredentialStatus,
    ProviderPatch,
    ProviderRuntimeSnapshot,
    ProvidersPatchRequest,
    ProvidersSnapshot,
} from "./provider-settings.js"
