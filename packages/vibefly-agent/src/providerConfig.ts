/** Host-backed pi provider snapshot helpers. Configuration persistence is Host-owned. */
import type {CredentialInfo} from "@earendil-works/pi-ai"
import type {
    ProviderCredentialStatus,
    ProviderRuntimeSnapshot,
    ProvidersPatchResult,
    ProvidersSnapshot,
} from "./generated/controlRpc.js"
import type {PiRuntime} from "./piRuntime.js"
import {log} from "./log.js"

let providersSnapshotSequence = 0

function credentialStatus(
    stored: readonly CredentialInfo[],
  providerId: string,
): ProviderCredentialStatus {
  const credential = stored.find((item) => item.providerId === providerId)
  const hasApiKey = credential?.type === "api_key"
  const hasOAuth = credential?.type === "oauth"
  return {
    hasApiKey,
    hasOAuth,
    originKind: hasOAuth ? "oauth" : hasApiKey ? "api_key" : "none",
  }
}

/** Serialize registered provider config into a JSON-safe models.json-style entry. */
function configJsonFromRegistered(
    config: ReturnType<PiRuntime["modelRuntime"]["getRegisteredProviderConfig"]>,
): string | null {
    if (!config) return null
    const entry: Record<string, unknown> = {}
    if (typeof config.name === "string" && config.name.trim()) entry.name = config.name
    if (typeof config.baseUrl === "string" && config.baseUrl.trim()) entry.baseUrl = config.baseUrl
    if (typeof config.api === "string" && config.api.trim()) entry.api = config.api
    if (typeof config.authHeader === "boolean") entry.authHeader = config.authHeader
    if (config.headers && typeof config.headers === "object") entry.headers = {...config.headers}
    if (Array.isArray(config.models) && config.models.length > 0) {
        entry.models = config.models.map((model) => {
            const out: Record<string, unknown> = {
                id: model.id,
                name: model.name,
                reasoning: model.reasoning,
                input: [...model.input],
                cost: structuredClone(model.cost),
                contextWindow: model.contextWindow,
                maxTokens: model.maxTokens,
            }
            if (typeof model.api === "string" && model.api.trim()) out.api = model.api
            if (typeof model.baseUrl === "string" && model.baseUrl.trim()) out.baseUrl = model.baseUrl
            if (model.headers && typeof model.headers === "object") out.headers = {...model.headers}
            if (model.compat && typeof model.compat === "object") out.compat = structuredClone(model.compat)
            if (model.thinkingLevelMap && typeof model.thinkingLevelMap === "object") {
                out.thinkingLevelMap = structuredClone(model.thinkingLevelMap)
            }
            return out
        })
    }
    return JSON.stringify(entry)
}

export async function getProvidersSnapshot(runtime: PiRuntime): Promise<ProvidersSnapshot> {
  const requestId = `memory-${++providersSnapshotSequence}`
  const started = performance.now()
  const stored = await runtime.auth.list()
  const configuredIds = runtime.modelRuntime.getRegisteredProviderIds()
  const ids = new Set([
    ...configuredIds,
    ...stored.map((credential) => credential.providerId),
  ])
  const providers: ProviderRuntimeSnapshot[] = [...ids]
      .sort((a, b) => a.localeCompare(b))
      .map((id) => {
          const config = runtime.modelRuntime.getRegisteredProviderConfig(id)
          return {
        id,
              configJson: configJsonFromRegistered(config),
              credential: credentialStatus(stored, id),
          }
      })
  log.info("providers snapshot done", {
    requestId,
    providers: providers.length,
    totalMs: Math.round(performance.now() - started),
  })
    return {providers}
}

export function rejectAgentProviderPatch(): ProvidersPatchResult {
  return {
    ok: false,
    error: "Provider configuration is owned by the Host settings service",
  }
}
