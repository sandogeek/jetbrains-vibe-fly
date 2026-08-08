import {describe, test} from "node:test"
import {expect} from "expect"
import type {BundledCatalog} from "./catalog"
import {mergeProvidersSnapshot} from "./providerSnapshots"

const catalog: BundledCatalog = {
  providerOrder: ["anthropic", "openai"],
  providers: [
    {
      id: "anthropic",
      supportsLogin: true,
    },
    {
      id: "openai",
      loginProviderId: "openai-codex-device",
    },
  ],
  providerRank: new Map([
    ["anthropic", 0],
    ["openai", 1],
  ]),
}

describe("mergeProvidersSnapshot", () => {
  test("combines generated metadata with RPC state and keeps custom providers", () => {
    const snapshot = mergeProvidersSnapshot(
      {
        providers: [
          {
            id: "anthropic",
            credential: { hasOAuth: true, originKind: "oauth" },
          },
          {
            id: "my-proxy",
              configJson: JSON.stringify({
                  baseUrl: "https://proxy.example/v1",
                  api: "openai-completions",
                  models: [{id: "demo", name: "Demo"}],
              }),
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
      expect(custom?.baseUrl).toBe("https://proxy.example/v1")
  })

  test("preserves a missing RPC snapshot as null", () => {
    expect(mergeProvidersSnapshot(null, catalog)).toBeNull()
  })

    test("exposes full configJson including headers apiKey and URL query without auth.json secrets", () => {
        const configJson = JSON.stringify({
            baseUrl: "https://user:password@example.com/v1?token=secret",
            api: "openai-completions",
            apiKey: "provider-level-key",
            headers: {"X-A": "1"},
            models: [{id: "m", name: "M"}],
        })
        const snapshot = mergeProvidersSnapshot(
            {
                providers: [{
                    id: "my-proxy",
                    configJson,
                    credential: {hasApiKey: true, originKind: "api_key"},
                }],
            },
            catalog,
        )

        const custom = snapshot?.providers.find((provider) => provider.id === "my-proxy")
        expect(custom?.configJson).toContain("provider-level-key")
        expect(custom?.configJson).toContain("token=secret")
        expect(custom?.configJson).toContain("X-A")
        expect(custom?.baseUrl).toBe("https://user:password@example.com/v1?token=secret")
        // auth.json contents are never in the RPC snapshot
        const serialized = JSON.stringify(snapshot)
        expect(serialized).not.toContain("super-secret-from-auth")
    })
})
