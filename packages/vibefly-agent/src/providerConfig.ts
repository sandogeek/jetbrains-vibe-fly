/** Document-based provider snapshot and patch helpers. Persistence stays Host-owned. */
import {applyProviderConfigPatch, mutateCustomProviderDocuments, snapshotProviders} from "@vibefly/uiagent-shared/agent"
import type {
    CustomProviderMutationRequest,
    ModelsDocumentPatchResult,
    ProviderDocumentsPatchResult,
    ProvidersPatchRequest,
    ProvidersSnapshot,
} from "./generated/controlRpc.js"
import {log} from "./log.js"

let providersSnapshotSequence = 0

export function getProvidersSnapshot(modelsJson: string, authJson: string): ProvidersSnapshot {
    const requestId = `documents-${++providersSnapshotSequence}`
    const started = performance.now()
    const snapshot = snapshotProviders(modelsJson, authJson)
    log.info("providers snapshot done", {
        requestId,
        providers: snapshot.providers.length,
        totalMs: Math.round(performance.now() - started),
    })
    return snapshot
}

export function applyProviderConfigDocumentsPatch(
    request: ProvidersPatchRequest,
    modelsJson: string,
): ModelsDocumentPatchResult {
    try {
        const patched = applyProviderConfigPatch(modelsJson, request)
        return {
            ok: true,
            modelsJson: patched.modelsJson,
            modelsChanged: patched.modelsChanged,
        }
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}

export function mutateCustomProviderDocumentsPatch(
    request: CustomProviderMutationRequest,
    modelsJson: string,
    authJson: string,
): ProviderDocumentsPatchResult {
    try {
        const patched = mutateCustomProviderDocuments(modelsJson, authJson, {
            id: request.id,
            remove: request.remove,
            configJson: request.configJson,
            apiKey: request.apiKey,
        })
        return {
            ok: true,
            modelsJson: patched.modelsJson,
            authJson: patched.authJson,
            modelsChanged: patched.modelsChanged,
            authChanged: patched.authChanged,
            snapshot: patched.snapshot,
        }
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}
