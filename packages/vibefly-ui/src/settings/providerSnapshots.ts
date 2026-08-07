import type {
    ProviderCredentialStatus,
    ProviderModelSnapshot,
    ProviderRuntimeSnapshot,
    ProvidersSnapshot as RpcProvidersSnapshot,
} from "../generated/rpc"
import type {BundledCatalog} from "./catalog"

export type ProviderSnapshot = {
    id: string
    isConfigured?: boolean
    baseUrl?: string | null
    api?: string | null
    models?: ProviderModelSnapshot[]
    credential?: ProviderCredentialStatus
    isCatalog: boolean
    supportsLogin: boolean
    loginProviderId: string | null
}

export type ProvidersSnapshot = {
    providers: ProviderSnapshot[]
}

function safeProviderUrl(raw: string | null | undefined): string | null | undefined {
    if (raw == null || !raw.trim()) return raw
    try {
        const parsed = new URL(raw)
        parsed.username = ""
        parsed.password = ""
        parsed.search = ""
        parsed.hash = ""
        return parsed.toString()
    } catch {
        return undefined
    }
}

function safeRuntimeSnapshot(
    raw: ProviderRuntimeSnapshot | undefined,
    id: string,
): Omit<ProviderSnapshot, "isCatalog" | "supportsLogin" | "loginProviderId"> {
    return {
        id,
        isConfigured: Boolean(raw?.isConfigured),
        baseUrl: safeProviderUrl(raw?.baseUrl),
        api: typeof raw?.api === "string" ? raw.api : null,
        models: (raw?.models ?? []).map((model) => ({
            id: model.id,
            name: typeof model.name === "string" ? model.name : null,
            api: typeof model.api === "string" ? model.api : null,
            isCustom: Boolean(model.isCustom),
        })),
        credential: {
            hasApiKey: Boolean(raw?.credential?.hasApiKey),
            hasOAuth: Boolean(raw?.credential?.hasOAuth),
            originKind: typeof raw?.credential?.originKind === "string"
                ? raw.credential.originKind
                : "none",
        },
    }
}

/** Merge immutable generated metadata with mutable state returned by RPC. */
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
            ...safeRuntimeSnapshot(runtime, provider.id),
            isCatalog: true,
            supportsLogin: Boolean(provider.supportsLogin),
            loginProviderId: provider.loginProviderId ?? null,
        })
    }

    for (const runtime of runtimeById.values()) {
        providers.push({
            ...safeRuntimeSnapshot(runtime, runtime.id),
            isCatalog: false,
            supportsLogin: false,
            loginProviderId: null,
        })
    }
    providers.sort((a, b) => a.id.localeCompare(b.id))

    return {providers}
}
