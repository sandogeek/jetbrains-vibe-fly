/**
 * Export a slim model catalog JSON for the vibefly-ui static assets.
 *
 * Source: same-version `@oh-my-pi/pi-catalog` as this agent package.
 * Output: packages/vibefly-ui/public/catalog/bundled-catalog.json (committed).
 * Packaged into vibefly-jcef web resources by Vite (`public/` → resources/web).
 *
 * Omits default/false/null fields to keep the payload small; UI fills defaults.
 *
 * Usage: bun run scripts/export-bundled-catalog.ts
 * Or:    bun run export:catalog
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import {
  getBundledModels,
  getBundledProviders,
  type GeneratedProvider,
} from "@oh-my-pi/pi-catalog/models"
import { buildModelProviderPriorityRank } from "@oh-my-pi/pi-catalog/identity"

type SlimModel = {
  id: string
  name?: string
  api?: string
  contextWindow?: number
  vision?: boolean
  inputCostPerMTok?: number
  outputCostPerMTok?: number
  reasoning?: boolean
  toolsUnsupported?: boolean
  priority?: number
}

type SlimProvider = {
  id: string
  models: SlimModel[]
}

type SlimCatalog = {
  providerOrder: string[]
  providers: SlimProvider[]
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

function slimModel(m: {
  id: string
  name?: string
  api?: string
  reasoning?: boolean
  input?: readonly string[]
  supportsTools?: boolean
  cost?: { input?: number; output?: number }
  contextWindow?: number | null
  priority?: number
}): SlimModel {
  const out: SlimModel = { id: String(m.id) }
  const name = m.name != null ? String(m.name) : ""
  if (name && name !== out.id) out.name = name
  if (typeof m.api === "string" && m.api) out.api = m.api

  if (isFiniteNumber(m.contextWindow) && m.contextWindow > 0) {
    out.contextWindow = m.contextWindow
  }

  if (Array.isArray(m.input) && m.input.includes("image")) {
    out.vision = true
  }

  const costIn = m.cost?.input
  const costOut = m.cost?.output
  if (isFiniteNumber(costIn)) out.inputCostPerMTok = costIn
  if (isFiniteNumber(costOut)) out.outputCostPerMTok = costOut

  if (m.reasoning === true) out.reasoning = true
  if (m.supportsTools === false) out.toolsUnsupported = true
  if (isFiniteNumber(m.priority)) out.priority = m.priority

  return out
}

function buildCatalog(): SlimCatalog {
  const rank = buildModelProviderPriorityRank()
  const providerOrder = [...rank.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id)

  const providers: SlimProvider[] = []
  for (const provider of getBundledProviders()) {
    const providerId = String(provider)
    let models: SlimModel[] = []
    try {
      const bundled = getBundledModels(provider as GeneratedProvider)
      models = bundled.map((m) => slimModel(m as Parameters<typeof slimModel>[0]))
    } catch {
      models = []
    }
    providers.push({ id: providerId, models })
  }
  providers.sort((a, b) => a.id.localeCompare(b.id))
  return { providerOrder, providers }
}

function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(here, "../../..")
  const outPath = path.join(
    repoRoot,
    "packages/vibefly-ui/public/catalog/bundled-catalog.json",
  )
  const catalog = buildCatalog()
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  // Compact JSON (no pretty indent) — still readable enough; smaller jar.
  fs.writeFileSync(outPath, `${JSON.stringify(catalog)}\n`, "utf8")
  const bytes = fs.statSync(outPath).size
  const modelCount = catalog.providers.reduce((n, p) => n + p.models.length, 0)
  console.error(
    `export-bundled-catalog: ${catalog.providers.length} providers, ` +
      `${modelCount} models, ${(bytes / 1024).toFixed(1)} KiB → ${outPath}`,
  )
}

main()
