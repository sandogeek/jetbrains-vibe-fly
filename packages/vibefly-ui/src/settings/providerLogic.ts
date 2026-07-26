import type { ProviderSnapshot } from "../generated/rpc"
import { description, displayName } from "./providerLabels"

export type ProviderBadge = "custom" | "api_key" | "oauth" | "configured"

export type ClassifiedProviders = {
  connected: ProviderSnapshot[]
  popular: ProviderSnapshot[]
}

/** Connected = usable for default model / agent traffic. */
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
  return { connected, popular }
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

export function badgeLabel(badge: ProviderBadge): string {
  switch (badge) {
    case "custom":
      return "CUSTOM"
    case "api_key":
      return "API KEY"
    case "oauth":
      return "OAUTH"
    case "configured":
      return "CONFIGURED"
  }
}

export function credentialStatusText(snap: ProviderSnapshot): string {
  const parts: string[] = []
  const cred = snap.credential
  if (cred?.hasApiKey) {
    parts.push(`API key set (${cred.originKind ?? "unknown"})`)
  } else {
    parts.push("No API key")
  }
  if (cred?.hasOAuth) {
    parts.push("OAuth session present")
  } else if (snap.supportsLogin) {
    parts.push("Login available")
  }
  return parts.join(" · ")
}

export function parseModelSpec(raw: string): { provider: string; model: string } {
  const text = raw.trim()
  if (!text) return { provider: "", model: "" }
  const slash = text.indexOf("/")
  if (slash <= 0) return { provider: "", model: "" }
  return { provider: text.slice(0, slash), model: text.slice(slash + 1) }
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
): string | null {
  const trimmed = id.trim()
  if (!trimmed) return "Provider id is required"
  if (isEdit) return null
  if (catalogIds.has(trimmed)) return "Id conflicts with a catalog provider"
  if (existingCustomIds.has(trimmed)) return "A custom provider with this id already exists"
  if (!ID_PATTERN.test(trimmed)) {
    return "Use letters, digits, '.', '_' or '-' (must start with letter/digit)"
  }
  return null
}

export type ParsedModelLine = { id: string; name?: string; api?: string }

export function parseModelsText(text: string): ParsedModelLine[] {
  const out: ParsedModelLine[] = []
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const parts = line.split("|").map((p) => p.trim())
    const id = parts[0] ?? ""
    if (!id) continue
    const name = parts[1] || undefined
    const api = parts[2] || undefined
    out.push({
      id,
      name: name && name !== id ? name : undefined,
      api: api || undefined,
    })
  }
  return out
}

export function formatModelsText(
  models: Array<{ id: string; name?: string | null; api?: string | null }>,
): string {
  return models
    .map((m) => {
      const name = m.name?.trim() && m.name !== m.id ? m.name.trim() : ""
      const api = m.api?.trim() ?? ""
      if (name && api) return `${m.id} | ${name} | ${api}`
      if (name) return `${m.id} | ${name}`
      if (api) return `${m.id} | | ${api}`
      return m.id
    })
    .join("\n")
}
