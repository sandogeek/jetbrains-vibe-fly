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
} from "./settings.js"

export type AgentApplicationSettingsSnapshot = SafeApplicationSettingsSnapshot & {
    modelsJson: string
    authJson: string
}

export type AgentProjectSettingsSnapshot = SafeProjectSettingsSnapshot

export type AgentSettingsSnapshot =
    | AgentApplicationSettingsSnapshot
    | AgentProjectSettingsSnapshot

export type ModelsSettings = JsonObject & {
    providers?: Record<string, JsonObject>
}

export type CredentialMap = Record<string, JsonObject>

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
