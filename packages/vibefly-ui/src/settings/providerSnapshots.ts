import type {
    ProviderCredentialStatus,
    ProviderRuntimeSnapshot,
    ProvidersSnapshot as RpcProvidersSnapshot,
} from "../generated/rpc"
import type {BundledCatalog} from "./catalog"
import {modelsFromConfigJson, type ParsedProviderModel, providerFieldFromConfigJson} from "./providerConfigDraft"

export type ProviderSnapshot = {
    id: string
    configJson?: string | null
    models?: ParsedProviderModel[]
    baseUrl?: string | null
    api?: string | null
    credential?: ProviderCredentialStatus
    isCatalog: boolean
    supportsLogin: boolean
    loginProviderId: string | null
}

export type ProvidersSnapshot = {
    providers: ProviderSnapshot[]
}

function runtimeSnapshot(
    raw: ProviderRuntimeSnapshot | undefined,
    id: string,
): Omit<ProviderSnapshot, "isCatalog" | "supportsLogin" | "loginProviderId"> {
    const configJson = typeof raw?.configJson === "string" ? raw.configJson : null
    return {
        id,
        configJson,
        models: modelsFromConfigJson(configJson),
        baseUrl: providerFieldFromConfigJson(configJson, "baseUrl"),
        api: providerFieldFromConfigJson(configJson, "api"),
        credential: {
            hasApiKey: Boolean(raw?.credential?.hasApiKey),
            hasOAuth: Boolean(raw?.credential?.hasOAuth),
            originKind: typeof raw?.credential?.originKind === "string"
                ? raw.credential.originKind
                : "none",
        },
    }
}

/**
 * Merge immutable generated metadata with mutable state returned by RPC.
 * 将不可变的生成元数据与 RPC 返回的可变状态合并。
 */
export function mergeProvidersSnapshot(
    snapshot: RpcProvidersSnapshot | null | undefined,
    catalog: BundledCatalog,
): ProvidersSnapshot | null {
    if (!snapshot) return null

    const runtimeById = new Map(
        (snapshot.providers ?? []).map((provider) => [provider.id, provider]),
    )
    const providers: ProviderSnapshot[] = []

    for (const provider of catalog.providers) {
        const runtime = runtimeById.get(provider.id)
        runtimeById.delete(provider.id)
        providers.push({
            ...runtimeSnapshot(runtime, provider.id),
            isCatalog: true,
            supportsLogin: Boolean(provider.supportsLogin),
            loginProviderId: provider.loginProviderId ?? null,
        })
    }

    for (const runtime of runtimeById.values()) {
        providers.push({
            ...runtimeSnapshot(runtime, runtime.id),
            isCatalog: false,
            supportsLogin: false,
            loginProviderId: null,
        })
    }
    providers.sort((a, b) => a.id.localeCompare(b.id))

    return {providers}
}
