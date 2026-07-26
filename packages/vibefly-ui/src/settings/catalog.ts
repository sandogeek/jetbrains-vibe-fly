export type CatalogModel = {
  id: string
  name?: string | null
  api?: string | null
  contextWindow?: number | null
  vision?: boolean | null
  inputCostPerMTok?: number | null
  outputCostPerMTok?: number | null
  reasoning?: boolean | null
  toolsUnsupported?: boolean | null
  priority?: number | null
}

export type CatalogProvider = {
  id: string
  models: CatalogModel[]
}

export type BundledCatalog = {
  providerOrder: string[]
  providers: CatalogProvider[]
  providerRank: Map<string, number>
  modelsByProvider: Map<string, CatalogModel[]>
}

const EMPTY: BundledCatalog = {
  providerOrder: [],
  providers: [],
  providerRank: new Map(),
  modelsByProvider: new Map(),
}

function indexCatalog(raw: {
  providerOrder?: string[]
  providers?: CatalogProvider[]
}): BundledCatalog {
  const providerOrder = raw.providerOrder ?? []
  const providers = raw.providers ?? []
  const providerRank = new Map<string, number>()
  providerOrder.forEach((id, i) => providerRank.set(id, i))
  const modelsByProvider = new Map<string, CatalogModel[]>()
  for (const p of providers) {
    modelsByProvider.set(p.id, p.models ?? [])
    if (!providerRank.has(p.id)) {
      providerRank.set(p.id, providerOrder.length + modelsByProvider.size)
    }
  }
  return { providerOrder, providers, providerRank, modelsByProvider }
}

/**
 * Fetch catalog from Vite public/ (dev) or classpath scheme (prod).
 * Failures return empty catalog — custom snapshot models still work.
 */
export async function loadBundledCatalog(): Promise<{
  catalog: BundledCatalog
  error: string | null
}> {
  try {
    const res = await fetch("./catalog/bundled-catalog.json", { cache: "no-cache" })
    if (!res.ok) {
      return { catalog: EMPTY, error: `Catalog HTTP ${res.status}` }
    }
    const json = (await res.json()) as {
      providerOrder?: string[]
      providers?: CatalogProvider[]
    }
    return { catalog: indexCatalog(json), error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { catalog: EMPTY, error: msg }
  }
}

export function providerRank(catalog: BundledCatalog, providerId: string): number {
  return catalog.providerRank.get(providerId) ?? catalog.providerOrder.length
}

export function catalogModels(catalog: BundledCatalog, providerId: string): CatalogModel[] {
  return catalog.modelsByProvider.get(providerId) ?? []
}

export function catalogProviderIds(catalog: BundledCatalog): Set<string> {
  return new Set(catalog.modelsByProvider.keys())
}

export const emptyCatalog = EMPTY
