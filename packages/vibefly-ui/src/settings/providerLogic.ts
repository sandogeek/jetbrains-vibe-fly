import type {ProviderSnapshot} from "./providerSnapshots"
import {description, displayName} from "./providerLabels"

export type ProviderBadge = "custom" | "api_key" | "oauth" | "configured"

export type ClassifiedProviders = {
    connected: ProviderSnapshot[]
    popular: ProviderSnapshot[]
}

/**
 * Connected = usable for default model / agent traffic.
 * 已连接 = 可用于默认模型 / Agent 流量。
 */
export function isConnected(snap: ProviderSnapshot): boolean {
    if (!snap.isCatalog) return true
    const cred = snap.credential
    return Boolean(cred?.hasApiKey || cred?.hasOAuth)
}

export function classifyProviders(providers: ProviderSnapshot[]): ClassifiedProviders {
    const connected = providers
        .filter(isConnected)
        .slice()
        .sort((a, b) => displayName(a.id).toLowerCase().localeCompare(displayName(b.id).toLowerCase()))
    const connectedIds = new Set(connected.map((p) => p.id))
    const popular = providers
        .filter((p) => p.isCatalog && !connectedIds.has(p.id))
        .slice()
        .sort((a, b) => displayName(a.id).toLowerCase().localeCompare(displayName(b.id).toLowerCase()))
    return {connected, popular}
}

export function filterBuiltInProviders(
    providers: ProviderSnapshot[],
    query: string,
): ProviderSnapshot[] {
    const needle = query.trim().toLowerCase()
    if (!needle) return providers
    return providers.filter((provider) => {
        return (
            provider.id.toLowerCase().includes(needle) ||
            displayName(provider.id).toLowerCase().includes(needle) ||
            description(provider.id).toLowerCase().includes(needle)
        )
    })
}

export function primaryBadge(snap: ProviderSnapshot): ProviderBadge {
    if (!snap.isCatalog) return "custom"
    if (snap.credential?.hasApiKey) return "api_key"
    if (snap.credential?.hasOAuth) return "oauth"
    return "configured"
}

export type ProviderUiLabels = {
    badgeCustom: string
    badgeApiKey: string
    badgeOauth: string
    badgeConfigured: string
    credApiKeySet: (origin: string) => string
    credNoApiKey: string
    credOauthPresent: string
    credLoginAvailable: string
    idRequired: string
    idCatalogConflict: string
    idCustomConflict: string
    idInvalid: string
}

export function badgeLabel(badge: ProviderBadge, labels?: ProviderUiLabels): string {
    switch (badge) {
        case "custom":
            return labels?.badgeCustom ?? "CUSTOM"
        case "api_key":
            return labels?.badgeApiKey ?? "API KEY"
        case "oauth":
            return labels?.badgeOauth ?? "OAUTH"
        case "configured":
            return labels?.badgeConfigured ?? "CONFIGURED"
    }
}

export function credentialStatusText(snap: ProviderSnapshot, labels?: ProviderUiLabels): string {
    const parts: string[] = []
    const cred = snap.credential
    if (cred?.hasApiKey) {
        parts.push(
            labels?.credApiKeySet(cred.originKind ?? "unknown") ??
            `API key set (${cred.originKind ?? "unknown"})`,
        )
    } else {
        parts.push(labels?.credNoApiKey ?? "No API key")
    }
    if (cred?.hasOAuth) {
        parts.push(labels?.credOauthPresent ?? "OAuth session present")
    } else if (snap.supportsLogin) {
        parts.push(labels?.credLoginAvailable ?? "Login available")
    }
    return parts.join(" · ")
}

export function parseModelSpec(raw: string): { provider: string; model: string } {
    const text = raw.trim()
    if (!text) return {provider: "", model: ""}
    const slash = text.indexOf("/")
    if (slash <= 0) return {provider: "", model: ""}
    return {provider: text.slice(0, slash), model: text.slice(slash + 1)}
}

export function modelSpec(provider: string, model: string): string {
    const p = provider.trim()
    const m = model.trim()
    if (!p || !m) return ""
    return `${p}/${m}`
}

export function resolveDefaultModelSpec(
    preferredProvider: string,
    preferredModel: string,
    options: string[],
    autoPick = false,
): string {
    const preferred = modelSpec(preferredProvider, preferredModel)
    if (preferred && options.includes(preferred)) return preferred
    if (autoPick) return options[0] ?? ""
    return ""
}

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function validateProviderId(
    id: string,
    catalogIds: Set<string>,
    existingCustomIds: Set<string>,
    isEdit: boolean,
    labels?: ProviderUiLabels,
): string | null {
    const trimmed = id.trim()
    if (!trimmed) return labels?.idRequired ?? "Provider id is required"
    if (isEdit) return null
    if (catalogIds.has(trimmed)) return labels?.idCatalogConflict ?? "Id conflicts with a catalog provider"
    if (existingCustomIds.has(trimmed)) {
        return labels?.idCustomConflict ?? "A custom provider with this id already exists"
    }
    if (!ID_PATTERN.test(trimmed)) {
        return labels?.idInvalid ?? "Use letters, digits, '.', '_' or '-' (must start with letter/digit)"
    }
    return null
}
