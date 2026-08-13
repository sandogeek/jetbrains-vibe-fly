import {bundledCatalog as generatedCatalog} from "../generated/bundledCatalog"
import {catalogModelLoaders} from "../generated/catalogModelLoaders"
import type {PackedModel} from "../generated/catalogModelTypes"

export type CatalogModel = {
  id: string
  name?: string | null
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
}

export type BundledCatalog = {
  providerOrder: string[]
  providers: CatalogProvider[]
  providerRank: Map<string, number>
}

const EMPTY: BundledCatalog = {
  providerOrder: [],
  providers: [],
  providerRank: new Map(),
}

// PackedModel tuple: [id, name, flags, contextWindow, inputCost, outputCost]
// PackedModel 元组：[id, name, flags, contextWindow, inputCost, outputCost]
const MFLAG_VISION = 1
const MFLAG_REASONING = 2
const MFLAG_TOOLS_UNSUPPORTED = 4

function expandModel(row: PackedModel): CatalogModel {
  const [id, name, flags, contextWindow, inputCost, outputCost] = row
  const out: CatalogModel = {id}
  if (typeof name === "string" && name && name !== id) out.name = name
  if (contextWindow > 0) out.contextWindow = contextWindow
  if (inputCost >= 0) out.inputCostPerMTok = inputCost
  if (outputCost >= 0) out.outputCostPerMTok = outputCost
  if (flags & MFLAG_VISION) out.vision = true
  if (flags & MFLAG_REASONING) out.reasoning = true
  if (flags & MFLAG_TOOLS_UNSUPPORTED) out.toolsUnsupported = true
  return out
}

function indexCatalog(raw: {
  providerOrder?: string[]
  providers?: CatalogProvider[]
}): BundledCatalog {
  const providerOrder = raw.providerOrder ?? []
  const providers = raw.providers ?? []
  const providerRank = new Map<string, number>()
  providerOrder.forEach((id, i) => providerRank.set(id, i))
  // Providers missing from providerOrder get stable ranks after the ordered list.
  // 未出现在 providerOrder 中的 Provider 在有序列表之后获得稳定 rank。
  for (const p of providers) {
    if (!providerRank.has(p.id)) {
      providerRank.set(p.id, providerOrder.length + providerRank.size)
    }
  }
  return {providerOrder, providers, providerRank}
}

/**
 * Immutable provider metadata compiled into the UI bundle (no model rows).
 * 编译进 UI bundle 的不可变 Provider 元数据（不含模型行）。
 */
export const bundledCatalog = indexCatalog(generatedCatalog)

export function providerRank(catalog: BundledCatalog, providerId: string): number {
  return catalog.providerRank.get(providerId) ?? catalog.providerOrder.length
}

export function catalogProviderIds(catalog: BundledCatalog): Set<string> {
  return new Set(catalog.providers.map((p) => p.id))
}

const modelCache = new Map<string, CatalogModel[]>()
const modelInflight = new Map<string, Promise<CatalogModel[]>>()

/**
 * Load packed models for one catalog provider (Vite-split chunk). Cached.
 * 加载单个 catalog Provider 的打包模型（Vite 分包）。带缓存。
 */
export function loadCatalogModels(providerId: string): Promise<CatalogModel[]> {
  const cached = modelCache.get(providerId)
  if (cached) return Promise.resolve(cached)

  const inflight = modelInflight.get(providerId)
  if (inflight) return inflight

  const loader = catalogModelLoaders[providerId]
  if (!loader) {
    const empty: CatalogModel[] = []
    modelCache.set(providerId, empty)
    return Promise.resolve(empty)
  }

  const pending = loader()
      .then((mod) => {
        const models = (mod.models ?? []).map(expandModel)
        modelCache.set(providerId, models)
        modelInflight.delete(providerId)
        return models
      })
      .catch((error) => {
        modelInflight.delete(providerId)
        throw error
      })
  modelInflight.set(providerId, pending)
  return pending
}

/**
 * Load models for the given provider ids (typically connected catalog providers).
 * 按给定 Provider id 加载模型（通常为已连接的 catalog Provider）。
 */
export async function loadCatalogModelsForProviders(
    providerIds: readonly string[],
): Promise<Map<string, CatalogModel[]>> {
  const unique = [...new Set(providerIds.filter(Boolean))]
  const entries = await Promise.all(
      unique.map(async (id) => [id, await loadCatalogModels(id)] as const),
  )
  return new Map(entries)
}

export const emptyCatalog = EMPTY
