import type { ProviderModelSnapshot, ProviderSnapshot } from "../generated/rpc"
import type { BundledCatalog, CatalogModel } from "./catalog"
import { catalogModels, providerRank } from "./catalog"
import { classifyProviders } from "./providerLogic"
import { displayName } from "./providerLabels"

export type ModelPickerTier = "follow_default" | "clear" | "pinned" | "recent" | "normal"

export type ModelBadgeKind =
  | "context"
  | "cost"
  | "reasoning"
  | "vision"
  | "tools_unsupported"

export type ModelBadge = {
  kind: ModelBadgeKind
  label: string
  searchText: string
  warning: boolean
}

export type ModelPickerEntry = {
  spec: string
  providerId: string
  providerLabel: string
  modelId: string
  modelLabel: string
  providerRank: number
  modelPriority: number
  badges: ModelBadge[]
  haystack: string
  providerIdLower: string
  providerLabelLower: string
  modelIdLower: string
  modelLabelLower: string
}

export type ModelPickerRow = {
  entry: ModelPickerEntry
  tier: ModelPickerTier
  groupLabel: string
  isFirstInGroup: boolean
}

export type ProviderOption = {
  id: string
  label: string
}

export type QueryToken = {
  raw: string
  providerPart: string | null
  modelPart: string | null
}

export const MAX_RECENT = 8

const WHITESPACE = /\s+/

function normalCompare(a: ModelPickerEntry, b: ModelPickerEntry): number {
  return (
    a.providerRank - b.providerRank ||
    a.providerLabelLower.localeCompare(b.providerLabelLower) ||
    a.modelPriority - b.modelPriority ||
    a.modelLabelLower.localeCompare(b.modelLabelLower) ||
    a.modelIdLower.localeCompare(b.modelIdLower)
  )
}

export function formatContextBadge(contextWindow: number | null | undefined): string | null {
  if (contextWindow == null || contextWindow <= 0) return null
  if (contextWindow >= 1_000_000) {
    const m = contextWindow / 1_000_000
    return Number.isInteger(m) ? `${m}M` : `${trimTrailingZeros(m.toFixed(1))}M`
  }
  if (contextWindow >= 1000) {
    const k = contextWindow / 1000
    return Number.isInteger(k) ? `${k}K` : `${trimTrailingZeros(k.toFixed(1))}K`
  }
  return String(contextWindow)
}

function formatCostNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return trimTrailingZeros(value.toFixed(2))
}

function trimTrailingZeros(s: string): string {
  if (!s.includes(".")) return s
  return s.replace(/0+$/, "").replace(/\.$/, "")
}

export function formatCostBadge(
  inputCost: number | null | undefined,
  outputCost: number | null | undefined,
): string | null {
  if (inputCost == null || outputCost == null) return null
  if (inputCost === 0 && outputCost === 0) return "free"
  return `$${formatCostNumber(inputCost)}/$${formatCostNumber(outputCost)}`
}

export function buildBadges(
  contextWindow: number | null | undefined,
  inputCost: number | null | undefined,
  outputCost: number | null | undefined,
  reasoning: boolean,
  vision: boolean,
  toolsUnsupported: boolean,
): ModelBadge[] {
  const badges: ModelBadge[] = []
  const ctx = formatContextBadge(contextWindow)
  if (ctx) {
    badges.push({
      kind: "context",
      label: ctx,
      searchText: `context window context length 上下文 ${ctx.toLowerCase()}`,
      warning: false,
    })
  }
  const cost = formatCostBadge(inputCost, outputCost)
  if (cost) {
    badges.push({
      kind: "cost",
      label: cost,
      searchText: `${cost === "free" ? "free 免费 " : ""}cost price pricing 价格 ${cost.toLowerCase()}`,
      warning: false,
    })
  }
  if (reasoning) {
    badges.push({
      kind: "reasoning",
      label: "reasoning",
      searchText: "reasoning thinking 推理 思考",
      warning: false,
    })
  }
  if (vision) {
    badges.push({
      kind: "vision",
      label: "vision",
      searchText: "vision image images visual multimodal 视觉 图片 图像 多模态",
      warning: false,
    })
  }
  if (toolsUnsupported) {
    badges.push({
      kind: "tools_unsupported",
      label: "no tools",
      searchText: "no tools tools unsupported without tools 不支持工具 无工具",
      warning: true,
    })
  }
  return badges
}

function entryFromBundled(
  providerId: string,
  providerLabel: string,
  rank: number,
  m: CatalogModel,
): ModelPickerEntry {
  const name = (m.name && m.name.trim()) || m.id
  const badges = buildBadges(
    m.contextWindow,
    m.inputCostPerMTok,
    m.outputCostPerMTok,
    Boolean(m.reasoning),
    Boolean(m.vision),
    Boolean(m.toolsUnsupported),
  )
  const providerIdLower = providerId.toLowerCase()
  const providerLabelLower = providerLabel.toLowerCase()
  const modelIdLower = m.id.toLowerCase()
  const modelLabelLower = name.toLowerCase()
  return {
    spec: `${providerId}/${m.id}`,
    providerId,
    providerLabel,
    modelId: m.id,
    modelLabel: name,
    providerRank: rank,
    modelPriority: m.priority ?? Number.MAX_SAFE_INTEGER,
    badges,
    haystack: `${providerIdLower} ${providerLabelLower} ${modelIdLower} ${modelLabelLower} ${badges.map((badge) => badge.searchText).join(" ")}`,
    providerIdLower,
    providerLabelLower,
    modelIdLower,
    modelLabelLower,
  }
}

function entryFromCustom(
  providerId: string,
  providerLabel: string,
  rank: number,
  m: ProviderModelSnapshot,
): ModelPickerEntry {
  const name = (m.name && m.name.trim()) || m.id
  const providerIdLower = providerId.toLowerCase()
  const providerLabelLower = providerLabel.toLowerCase()
  const modelIdLower = m.id.toLowerCase()
  const modelLabelLower = name.toLowerCase()
  return {
    spec: `${providerId}/${m.id}`,
    providerId,
    providerLabel,
    modelId: m.id,
    modelLabel: name,
    providerRank: rank,
    modelPriority: Number.MAX_SAFE_INTEGER,
    badges: [],
    haystack: `${providerIdLower} ${providerLabelLower} ${modelIdLower} ${modelLabelLower}`,
    providerIdLower,
    providerLabelLower,
    modelIdLower,
    modelLabelLower,
  }
}

export function buildEntries(
  connectedSnapshots: ProviderSnapshot[],
  catalog: BundledCatalog,
): ModelPickerEntry[] {
  const connected = classifyProviders(connectedSnapshots).connected
  const out: ModelPickerEntry[] = []
  for (const snap of connected) {
    const providerId = snap.id
    const providerLabel = displayName(providerId)
    const rank = providerRank(catalog, providerId)
    if (snap.isCatalog) {
      for (const m of catalogModels(catalog, providerId)) {
        out.push(entryFromBundled(providerId, providerLabel, rank, m))
      }
    } else {
      for (const m of snap.models ?? []) {
        out.push(entryFromCustom(providerId, providerLabel, rank, m))
      }
    }
  }
  out.sort(normalCompare)
  return out
}

export function tokenizeQuery(query: string): QueryToken[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  const lower = trimmed.toLowerCase()
  const parts = lower.split(WHITESPACE)
  const out: QueryToken[] = []
  for (const raw of parts) {
    if (!raw) continue
    const slash = raw.indexOf("/")
    if (slash >= 0) {
      out.push({
        raw,
        providerPart: raw.slice(0, slash) || null,
        modelPart: raw.slice(slash + 1) || null,
      })
    } else {
      out.push({ raw, providerPart: null, modelPart: null })
    }
  }
  return out
}

function matchField(field: string, token: string): number | null {
  if (!token) return 100
  if (field === token) return 100
  if (field.startsWith(token)) return 60
  let i = field.indexOf(token)
  while (i >= 0) {
    if (i === 0 || !/[a-zA-Z0-9]/.test(field[i - 1]!)) return 40
    i = field.indexOf(token, i + 1)
  }
  if (field.includes(token)) return 20
  return null
}

function scoreToken(entry: ModelPickerEntry, token: QueryToken): number | null {
  const { providerPart, modelPart } = token
  if (providerPart != null || modelPart != null) {
    if (providerPart != null) {
      const pScore =
        matchField(entry.providerIdLower, providerPart) ??
        matchField(entry.providerLabelLower, providerPart)
      if (pScore == null) return null
      if (!modelPart) return pScore
      const mScore =
        matchField(entry.modelIdLower, modelPart) ?? matchField(entry.modelLabelLower, modelPart)
      if (mScore == null) return null
      return Math.max(pScore, mScore)
    }
    if (modelPart != null) {
      return (
        matchField(entry.modelIdLower, modelPart) ?? matchField(entry.modelLabelLower, modelPart)
      )
    }
  }
  const scores = [
    matchField(entry.modelIdLower, token.raw),
    matchField(entry.modelLabelLower, token.raw),
    matchField(entry.providerIdLower, token.raw),
    matchField(entry.providerLabelLower, token.raw),
    matchField(entry.haystack, token.raw),
  ].filter((score): score is number => score != null)
  return scores.length > 0 ? Math.max(...scores) : null
}

export function scoreEntry(entry: ModelPickerEntry, tokens: QueryToken[]): number | null {
  if (tokens.length === 0) return 0
  let total = 0
  for (const token of tokens) {
    const s = scoreToken(entry, token)
    if (s == null) return null
    total += s
  }
  return total
}

function matchesFollowDefault(tokens: QueryToken[]): boolean {
  if (tokens.length === 0) return true
  const labels = ["follow", "default", "model", "follow default model", "跟随", "默认", "默认模型", "跟随默认模型"]
  return tokens.every((t) => labels.some((label) => label.includes(t.raw)))
}

function matchesNoDefault(tokens: QueryToken[]): boolean {
  if (tokens.length === 0) return true
  const labels = ["none", "no default", "no default model", "无默认", "无默认模型", "清除"]
  return tokens.every((t) => labels.some((label) => label.includes(t.raw)))
}

function followDefaultEntry(): ModelPickerEntry {
  return {
    spec: "",
    providerId: "",
    providerLabel: "",
    modelId: "",
    modelLabel: "Follow default model",
    providerRank: Number.MIN_SAFE_INTEGER,
    modelPriority: Number.MIN_SAFE_INTEGER,
    badges: [],
    haystack: "follow default",
    providerIdLower: "",
    providerLabelLower: "",
    modelIdLower: "",
    modelLabelLower: "follow default model",
  }
}

function noDefaultEntry(): ModelPickerEntry {
  return {
    spec: "",
    providerId: "",
    providerLabel: "",
    modelId: "",
    modelLabel: "No default model",
    providerRank: Number.MIN_SAFE_INTEGER,
    modelPriority: Number.MIN_SAFE_INTEGER,
    badges: [],
    haystack: "no default none",
    providerIdLower: "",
    providerLabelLower: "",
    modelIdLower: "",
    modelLabelLower: "no default model",
  }
}

export function rank(
  entries: ModelPickerEntry[],
  query: string,
  pinnedSpecs: string[],
  recentSpecs: string[],
  includeFollowDefault: boolean,
  providerId: string | null = null,
  includeClear = false,
): ModelPickerRow[] {
  const scopedProvider = providerId?.trim() || null
  const scoped = scopedProvider ? entries.filter((e) => e.providerId === scopedProvider) : entries

  const bySpec = new Map<string, ModelPickerEntry>()
  for (const e of scoped) bySpec.set(e.spec, e)

  const pinnedInEntries: ModelPickerEntry[] = []
  const pinnedSet = new Set<string>()
  for (const spec of pinnedSpecs) {
    const e = bySpec.get(spec)
    if (!e) continue
    if (pinnedSet.has(e.spec)) continue
    pinnedSet.add(e.spec)
    pinnedInEntries.push(e)
  }

  const recentInEntries: ModelPickerEntry[] = []
  const recentSet = new Set<string>()
  for (const spec of recentSpecs) {
    if (pinnedSet.has(spec)) continue
    const e = bySpec.get(spec)
    if (!e) continue
    if (recentSet.has(e.spec)) continue
    recentSet.add(e.spec)
    recentInEntries.push(e)
  }

  const tokens = tokenizeQuery(query)
  const hasQuery = tokens.length > 0
  const scored = hasQuery
    ? (() => {
        const map = new Map<string, number>()
        for (const e of scoped) {
          const score = scoreEntry(e, tokens)
          if (score != null) map.set(e.spec, score)
        }
        return map
      })()
    : null

  const rows: ModelPickerRow[] = []

  if (!scopedProvider && includeFollowDefault && matchesFollowDefault(tokens)) {
    rows.push({
      entry: followDefaultEntry(),
      tier: "follow_default",
      groupLabel: "Default",
      isFirstInGroup: true,
    })
  }
  if (!scopedProvider && includeClear && matchesNoDefault(tokens)) {
    rows.push({
      entry: noDefaultEntry(),
      tier: "clear",
      groupLabel: "Default",
      isFirstInGroup: true,
    })
  }

  if (hasQuery) {
    const matched = scoped.filter((entry) => scored?.has(entry.spec))
    matched.sort((a, b) => {
      const scoreDelta = (scored?.get(b.spec) ?? 0) - (scored?.get(a.spec) ?? 0)
      if (scoreDelta) return scoreDelta
      const pinDelta = Number(pinnedSet.has(b.spec)) - Number(pinnedSet.has(a.spec))
      if (pinDelta) return pinDelta
      const recentDelta = Number(recentSet.has(b.spec)) - Number(recentSet.has(a.spec))
      return recentDelta || normalCompare(a, b)
    })
    for (const entry of matched) {
      rows.push({ entry, tier: "normal", groupLabel: "", isFirstInGroup: false })
    }
    return rows
  }

  const appendTier = (
    list: ModelPickerEntry[],
    tier: ModelPickerTier,
    groupLabel: string,
  ) => {
    if (list.length === 0) return
    let first = true
    for (const e of list) {
      rows.push({ entry: e, tier, groupLabel, isFirstInGroup: first })
      first = false
    }
  }

  appendTier(
    pinnedInEntries,
    "pinned",
    "Pinned",
  )
  appendTier(
    recentInEntries,
    "recent",
    "Recent",
  )

  const normal: ModelPickerEntry[] = []
  for (const e of scoped) {
    if (!pinnedSet.has(e.spec) && !recentSet.has(e.spec)) normal.push(e)
  }
  normal.sort(normalCompare)

  const hideProviderGroups = scopedProvider != null
  let lastGroup: string | null = null
  for (const e of normal) {
    const group = e.providerLabel
    const first = hideProviderGroups ? false : group !== lastGroup
    lastGroup = group
    rows.push({
      entry: e,
      tier: "normal",
      groupLabel: hideProviderGroups ? "" : group,
      isFirstInGroup: first,
    })
  }
  return rows
}

export function listProviders(entries: ModelPickerEntry[]): ProviderOption[] {
  if (entries.length === 0) return []
  const best = new Map<string, ModelPickerEntry>()
  for (const e of entries) {
    const prev = best.get(e.providerId)
    if (
      !prev ||
      e.providerRank < prev.providerRank ||
      (e.providerRank === prev.providerRank && e.providerLabelLower < prev.providerLabelLower)
    ) {
      best.set(e.providerId, e)
    }
  }
  return [...best.values()]
    .sort(
      (a, b) =>
        a.providerRank - b.providerRank ||
        a.providerLabelLower.localeCompare(b.providerLabelLower) ||
        a.providerIdLower.localeCompare(b.providerIdLower),
    )
    .map((e) => ({ id: e.providerId, label: e.providerLabel }))
}

/** Local MRU update (cap 8, dedupe front). */
export function recordUsed(recent: string[], spec: string): string[] {
  const key = spec.trim()
  if (!key) return recent
  const next = [key, ...recent.filter((s) => s !== key)]
  return next.slice(0, MAX_RECENT)
}

export function togglePinned(pinned: string[], spec: string): string[] {
  const key = spec.trim()
  if (!key) return pinned
  if (pinned.includes(key)) return pinned.filter((s) => s !== key)
  return [key, ...pinned.filter((s) => s !== key)]
}

export function displayLabel(entry: ModelPickerEntry, allowFollowDefault: boolean): string {
  if (!entry.spec) {
    return allowFollowDefault ? "Follow default model" : "No default model"
  }
  return `${entry.providerLabel} · ${entry.modelLabel}`
}
