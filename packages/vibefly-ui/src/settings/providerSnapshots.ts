import type {
  ProviderRuntimeSnapshot,
  ProvidersSnapshot as RpcProvidersSnapshot,
} from "../generated/rpc"
import type { BundledCatalog } from "./catalog"

export type ProviderSnapshot = ProviderRuntimeSnapshot & {
  isCatalog: boolean
  supportsLogin: boolean
  loginProviderId: string | null
}

export type ProvidersSnapshot = Omit<RpcProvidersSnapshot, "providers"> & {
  providers?: ProviderSnapshot[]
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
      ...runtime,
      id: provider.id,
      isCatalog: true,
      supportsLogin: Boolean(provider.supportsLogin),
      loginProviderId: provider.loginProviderId ?? null,
    })
  }

  for (const runtime of runtimeById.values()) {
    providers.push({
      ...runtime,
      isCatalog: false,
      supportsLogin: false,
      loginProviderId: null,
    })
  }
  providers.sort((a, b) => a.id.localeCompare(b.id))

  return { ...snapshot, providers }
}
