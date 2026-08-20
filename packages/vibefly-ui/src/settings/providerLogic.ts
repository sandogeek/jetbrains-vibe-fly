import type {ProviderSnapshot} from "./providerSnapshots"
import {displayName, searchAliases} from "./providerLabels"

export type ProviderBadge = "custom" | "api_key" | "oauth"

const SUBTITLE_SEPARATOR = " · "

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
            searchAliases(provider.id).some((alias) => alias.toLowerCase().includes(needle))
        )
    })
}

export function primaryBadge(snap: ProviderSnapshot): ProviderBadge | null {
    if (!snap.isCatalog) return "custom"
    if (snap.credential?.hasApiKey) return "api_key"
    if (snap.credential?.hasOAuth) return "oauth"
    return null
}

export type ProviderUiLabels = {
    badgeCustom: string
    badgeApiKey: string
    badgeOauth: string
    credApiKeySet: (origin: string) => string
    credNoApiKey: string
    credOauthPresent: string
    credLoginAvailable: string
    rowLoginOrApiKey: string
    rowApiKeyRequired: string
    rowApiKeySet: string
    rowOauthSignedIn: string
    rowCustomModelCount: (count: number) => string
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

/**
 * List-row subtitle: how to connect, or what is already configured.
 * 列表行小字：如何连接，或当前已配置了什么。
 */
export function providerRowSubtitle(snap: ProviderSnapshot, labels?: ProviderUiLabels): string {
    if (!snap.isCatalog) {
        return customProviderRowSubtitle(snap, labels)
    }
    if (!isConnected(snap)) {
        if (snap.supportsLogin) {
            return labels?.rowLoginOrApiKey ?? "Sign in or enter an API key"
        }
        return labels?.rowApiKeyRequired ?? "API key required"
    }
    const parts: string[] = []
    if (snap.credential?.hasApiKey) {
        parts.push(labels?.rowApiKeySet ?? "API key set")
    }
    if (snap.credential?.hasOAuth) {
        parts.push(labels?.rowOauthSignedIn ?? "Signed in with OAuth")
    }
    return parts.join(SUBTITLE_SEPARATOR)
}

function customProviderRowSubtitle(snap: ProviderSnapshot, labels?: ProviderUiLabels): string {
    const parts: string[] = []
    const baseUrl = snap.baseUrl?.trim()
    if (baseUrl) parts.push(baseUrl)
    const api = snap.api?.trim()
    if (api) parts.push(api)
    const modelCount = snap.models?.length ?? 0
    if (modelCount > 0) {
        parts.push(labels?.rowCustomModelCount(modelCount) ?? `${modelCount} models`)
    }
    if (snap.credential?.hasApiKey) {
        parts.push(labels?.rowApiKeySet ?? "API key set")
    } else {
        parts.push(labels?.credNoApiKey ?? "No API key")
    }
    if (snap.credential?.hasOAuth) {
        parts.push(labels?.rowOauthSignedIn ?? "Signed in with OAuth")
    }
    return parts.join(SUBTITLE_SEPARATOR)
}

/**
 * Hide the mono id when it is the same as the display name after normalizing case and [-_].
 * 将大小写与 [-_] 归一化后，id 与显示名相同时隐藏 mono id。
 */
export function shouldShowProviderId(id: string): boolean {
    return normalizeProviderLabel(id) !== normalizeProviderLabel(displayName(id))
}

function normalizeProviderLabel(value: string): string {
    return value.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
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
