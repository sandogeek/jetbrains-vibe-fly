/**
 * Oh My Pi login registry helpers (no AuthStorage / models.yml).
 */
import { getOAuthProviders } from "@oh-my-pi/pi-ai/oauth"

export function loginProviderIds(): Map<
  string,
  { name: string; storeAs?: string }
> {
  const map = new Map<string, { name: string; storeAs?: string }>()
  for (const p of getOAuthProviders()) {
    map.set(p.id, {
      name: p.name,
      storeAs: p.storeCredentialsAs,
    })
  }
  return map
}

/** Map model-provider id → login registry id when they differ. */
export function resolveLoginProviderId(providerId: string): string | null {
  const id = providerId.trim()
  if (!id) return null
  const map = loginProviderIds()
  if (map.has(id)) return id
  for (const [loginId, info] of map) {
    if (info.storeAs === id) return loginId
  }
  return null
}

export function providerSupportsLogin(providerId: string): boolean {
  return resolveLoginProviderId(providerId) != null
}

export function allLoginProviderIds(): string[] {
  return getOAuthProviders().map((p) => p.id)
}
