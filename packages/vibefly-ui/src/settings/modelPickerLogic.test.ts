import { describe, test } from "node:test"
import { expect } from "expect"
import { emptyCatalog, type BundledCatalog } from "./catalog"
import {
  buildBadges,
  buildEntries,
  buildOptionEntries,
  formatCostBadge,
  formatContextBadge,
  listProviders,
  rank,
  recordUsed,
  scoreEntry,
  tokenizeQuery,
  togglePinned,
} from "./modelPickerLogic"
import type { ProviderSnapshot } from "./providerSnapshots"

function catalogFixture(): BundledCatalog {
  return {
    providerOrder: ["anthropic", "openai"],
    providers: [
      {
        id: "anthropic",
        models: [
          {
            id: "claude-sonnet",
            name: "Claude Sonnet",
            priority: 1,
            contextWindow: 200_000,
            inputCostPerMTok: 3,
            outputCostPerMTok: 15,
            reasoning: true,
          },
          { id: "claude-haiku", name: "Claude Haiku", priority: 2 },
        ],
      },
      {
        id: "openai",
        models: [{ id: "gpt-4o", name: "GPT-4o", priority: 1, vision: true }],
      },
    ],
    providerRank: new Map([
      ["anthropic", 0],
      ["openai", 1],
    ]),
    modelsByProvider: new Map([
      [
        "anthropic",
        [
          {
            id: "claude-sonnet",
            name: "Claude Sonnet",
            priority: 1,
            contextWindow: 200_000,
            inputCostPerMTok: 3,
            outputCostPerMTok: 15,
            reasoning: true,
          },
          { id: "claude-haiku", name: "Claude Haiku", priority: 2 },
        ],
      ],
      ["openai", [{ id: "gpt-4o", name: "GPT-4o", priority: 1, vision: true }]],
    ]),
  }
}

function connectedSnaps(): ProviderSnapshot[] {
  return [
    {
      id: "anthropic",
      isCatalog: true,
      supportsLogin: true,
      loginProviderId: null,
      credential: { hasApiKey: true, hasOAuth: false, originKind: "api_key" },
    },
    {
      id: "openai",
      isCatalog: true,
      supportsLogin: false,
      loginProviderId: null,
      credential: { hasOAuth: true, hasApiKey: false, originKind: "oauth" },
    },
    {
      id: "my-proxy",
      isCatalog: false,
      supportsLogin: false,
      loginProviderId: null,
      models: [{ id: "demo", name: "Demo" }],
    },
  ]
}

describe("modelPickerLogic", () => {
  test("buildEntries merges catalog + custom connected", () => {
    const entries = buildEntries(connectedSnaps(), catalogFixture())
    const specs = entries.map((e) => e.spec)
    expect(specs).toContain("anthropic/claude-sonnet")
    expect(specs).toContain("openai/gpt-4o")
    expect(specs).toContain("my-proxy/demo")
  })

  test("badges format context cost reasoning vision", () => {
    expect(formatContextBadge(200_000)).toBe("200K")
    expect(formatContextBadge(1_000_000)).toBe("1M")
    expect(formatCostBadge(0, 0)).toBe("free")
    expect(formatCostBadge(3, 15)).toBe("$3/$15")
    const badges = buildBadges(200_000, 3, 15, true, true, true)
    expect(badges.map((badge) => badge.kind)).toEqual([
      "context",
      "cost",
      "reasoning",
      "vision",
      "tools_unsupported",
    ])
    expect(badges.find((badge) => badge.kind === "tools_unsupported")?.warning).toBe(true)
  })

  test("tokenize AND and slash query", () => {
    const entries = buildEntries(connectedSnaps(), catalogFixture())
    const andRows = rank(entries, "claude 4", [], [], false)
    expect(andRows).toEqual([])

    const slash = rank(entries, "anthropic/sonnet", [], [], false)
    expect(slash.map((r) => r.entry.spec)).toContain("anthropic/claude-sonnet")
  })

  test("search uses a single relevance-ranked result tier", () => {
    const entries = buildEntries(connectedSnaps(), catalogFixture())
    const rows = rank(
      entries,
      "claude",
      ["anthropic/claude-haiku"],
      ["anthropic/claude-sonnet"],
      false,
    )
    expect(rows.map((row) => row.entry.spec)).toEqual([
      "anthropic/claude-haiku",
      "anthropic/claude-sonnet",
    ])
    expect(rows.every((row) => row.tier === "normal")).toBe(true)
  })

  test("capabilities and localized default actions are searchable", () => {
    const entries = buildEntries(connectedSnaps(), catalogFixture())
    expect(rank(entries, "reasoning", [], [], false).map((row) => row.entry.spec)).toEqual([
      "anthropic/claude-sonnet",
    ])
    expect(rank(entries, "视觉", [], [], false).map((row) => row.entry.spec)).toEqual([
      "openai/gpt-4o",
    ])
    expect(rank(entries, "默认", [], [], true)[0]?.tier).toBe("follow_default")
    expect(rank(entries, "无默认", [], [], false, null, true)[0]?.tier).toBe("clear")
  })

  test("pin and recent tiers preserve order", () => {
    const entries = buildEntries(connectedSnaps(), catalogFixture())
    const rows = rank(
      entries,
      "",
      ["openai/gpt-4o", "missing/x", "anthropic/claude-haiku"],
      ["anthropic/claude-sonnet"],
      true,
    )
    expect(rows[0]?.tier).toBe("follow_default")
    const pinned = rows.filter((r) => r.tier === "pinned").map((r) => r.entry.spec)
    expect(pinned).toEqual(["openai/gpt-4o", "anthropic/claude-haiku"])
    const recent = rows.filter((r) => r.tier === "recent").map((r) => r.entry.spec)
    expect(recent).toEqual(["anthropic/claude-sonnet"])
  })

  test("provider scope and listProviders", () => {
    const entries = buildEntries(connectedSnaps(), catalogFixture())
    const openaiOnly = rank(entries, "", ["openai/gpt-4o", "anthropic/claude-haiku"], [], false, "openai")
    expect(openaiOnly.every((r) => !r.entry.spec || r.entry.providerId === "openai")).toBe(true)
    const providers = listProviders(entries).map((p) => p.id)
    expect(providers[0]).toBe("anthropic")
    expect(providers).toContain("my-proxy")
  })

  test("recordUsed and togglePinned", () => {
    expect(recordUsed(["a", "b"], "c")).toEqual(["c", "a", "b"])
    expect(recordUsed(["a", "b"], "b")).toEqual(["b", "a"])
    expect(togglePinned(["a"], "b")).toEqual(["b", "a"])
    expect(togglePinned(["a", "b"], "a")).toEqual(["b"])
  })

  test("tokenizeQuery slash parts", () => {
    expect(tokenizeQuery("openai/gpt")).toEqual([
      { raw: "openai/gpt", providerPart: "openai", modelPart: "gpt" },
    ])
    const entry = buildEntries(connectedSnaps(), catalogFixture()).find(
      (e) => e.spec === "openai/gpt-4o",
    )!
    expect(scoreEntry(entry, tokenizeQuery("openai/gpt"))).not.toBeNull()
  })

  test("empty catalog still builds custom entries", () => {
    const entries = buildEntries(connectedSnaps(), emptyCatalog)
    expect(entries.map((e) => e.spec)).toEqual(["my-proxy/demo"])
  })

  test("direct options preserve specs, provider order, and reasoning search", () => {
    const entries = buildOptionEntries([
      {
        spec: "local-grok/grok-4.5",
        providerId: "local-grok",
        modelId: "grok-4.5",
        modelLabel: "Grok 4.5",
        reasoning: true,
      },
      {
        spec: "openai/gpt-4o",
        providerId: "openai",
        modelId: "gpt-4o",
        modelLabel: "GPT-4o",
        reasoning: false,
      },
      {
        spec: "local-grok/grok-mini",
        providerId: "local-grok",
        modelId: "grok-mini",
        modelLabel: "Grok Mini",
        reasoning: false,
      },
    ])

    expect(entries.map((entry) => entry.spec)).toEqual([
      "local-grok/grok-4.5",
      "openai/gpt-4o",
      "local-grok/grok-mini",
    ])
    expect(listProviders(entries).map((provider) => provider.id)).toEqual([
      "local-grok",
      "openai",
    ])
    expect(rank(entries, "reasoning", [], [], false).map((row) => row.entry.spec)).toEqual([
      "local-grok/grok-4.5",
    ])
    expect(
      rank(entries, "", [], [], false)
        .filter((row) => row.entry.providerId === "local-grok")
        .map((row) => row.entry.spec),
    ).toEqual(["local-grok/grok-4.5", "local-grok/grok-mini"])
  })
})
