/** Host-backed pi provider snapshot helpers. Configuration persistence is Host-owned. */
import type {CredentialInfo} from "@earendil-works/pi-ai"
import type {
  ProviderCredentialStatus,
  ProviderModelSnapshot,
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

function configuredModels(runtime: PiRuntime, providerId: string): ProviderModelSnapshot[] {
  const registered = runtime.modelRuntime.getRegisteredProviderConfig(providerId)
  return (registered?.models ?? []).map((model) => ({
    id: model.id,
    name: model.name,
    api: model.api,
    isCustom: true,
  }))
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
          isConfigured: config !== undefined,
          baseUrl: config?.baseUrl,
          api: config?.api,
          models: configuredModels(runtime, id),
          credential: credentialStatus(stored, id),
        }
      })
  log.info("providers snapshot done", {
    requestId,
    providers: providers.length,
    totalMs: Math.round(performance.now() - started),
  })
  return {
    agentDir: runtime.agentDir,
    providers,
    modelsPath: null,
  }
}

export function rejectAgentProviderPatch(): ProvidersPatchResult {
  return {
    ok: false,
    error: "Provider configuration is owned by the Host settings service",
  }
}
