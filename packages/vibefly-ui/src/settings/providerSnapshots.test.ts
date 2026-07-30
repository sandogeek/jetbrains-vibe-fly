import { describe, expect, test } from "bun:test"
import type { BundledCatalog } from "./catalog"
import { mergeProvidersSnapshot } from "./providerSnapshots"

const catalog: BundledCatalog = {
  providerOrder: ["anthropic", "openai"],
  providers: [
    {
      id: "anthropic",
      supportsLogin: true,
      models: [],
    },
    {
      id: "openai",
      loginProviderId: "openai-codex-device",
      models: [],
    },
  ],
  providerRank: new Map([
    ["anthropic", 0],
    ["openai", 1],
  ]),
  modelsByProvider: new Map([
    ["anthropic", []],
    ["openai", []],
  ]),
}

describe("mergeProvidersSnapshot", () => {
  test("combines generated metadata with RPC state and keeps custom providers", () => {
    const snapshot = mergeProvidersSnapshot(
      {
        agentDir: "/tmp/agent",
        providers: [
          {
            id: "anthropic",
            credential: { hasOAuth: true, originKind: "oauth" },
          },
          {
            id: "my-proxy",
            isConfigured: true,
            models: [{ id: "demo" }],
          },
        ],
      },
      catalog,
    )

    const providers = snapshot?.providers ?? []
    const anthropic = providers.find((provider) => provider.id === "anthropic")
    expect(anthropic?.isCatalog).toBe(true)
    expect(anthropic?.supportsLogin).toBe(true)
    expect(anthropic?.credential?.hasOAuth).toBe(true)

    const openai = providers.find((provider) => provider.id === "openai")
    expect(openai?.isCatalog).toBe(true)
    expect(openai?.loginProviderId).toBe("openai-codex-device")

    const custom = providers.find((provider) => provider.id === "my-proxy")
    expect(custom?.isCatalog).toBe(false)
    expect(custom?.models?.[0]?.id).toBe("demo")
  })

  test("preserves a missing RPC snapshot as null", () => {
    expect(mergeProvidersSnapshot(null, catalog)).toBeNull()
  })
})
