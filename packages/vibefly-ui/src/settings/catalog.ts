import { bundledCatalog as generatedCatalog } from "../generated/bundledCatalog"

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
  supportsLogin?: boolean
  loginProviderId?: string | null
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

/** Immutable catalog compiled into the UI bundle; no runtime file fetch. */
export const bundledCatalog = indexCatalog(generatedCatalog)

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
