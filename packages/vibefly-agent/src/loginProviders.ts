/** Immutable Oh My Pi login registry metadata generated at build time. */
import { staticProviders } from "./generated/providerCatalog.js"

const staticProviderById = new Map(
  staticProviders.map((provider) => [provider.id, provider]),
)

/** Map model-provider id → login registry id when they differ. */
export function resolveLoginProviderId(providerId: string): string | null {
  const id = providerId.trim()
  if (!id) return null
  const provider = staticProviderById.get(id)
  if (!provider?.supportsLogin) return null
  return provider.loginProviderId ?? id
}

export function providerSupportsLogin(providerId: string): boolean {
  return resolveLoginProviderId(providerId) != null
}
