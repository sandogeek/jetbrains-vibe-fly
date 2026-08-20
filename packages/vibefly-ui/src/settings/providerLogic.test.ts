import {describe, test} from "node:test"
import {expect} from "expect"
import type {ProviderSnapshot} from "./providerSnapshots"
import {
  classifyProviders,
  filterBuiltInProviders,
  isConnected,
  parseModelSpec,
  primaryBadge,
  providerRowSubtitle,
  shouldShowProviderId,
  validateProviderId,
} from "./providerLogic"
import {displayName} from "./providerLabels"

const snaps: ProviderSnapshot[] = [
  {
    id: "openai",
    isCatalog: true,
    supportsLogin: false,
    loginProviderId: null,
    credential: { hasApiKey: true, hasOAuth: false, originKind: "api_key" },
  },
  {
    id: "anthropic",
    isCatalog: true,
    supportsLogin: true,
    loginProviderId: null,
    credential: { hasApiKey: false, hasOAuth: false, originKind: "none" },
  },
  {
    id: "my-proxy",
    isCatalog: false,
    supportsLogin: false,
    loginProviderId: null,
      models: [{id: "x", name: "x", api: null}],
  },
]

describe("providerLogic", () => {
  test("displayName", () => {
    expect(displayName("openai")).toBe("OpenAI")
    expect(displayName("unknown-x")).toBe("unknown-x")
  })

  test("isConnected and classify", () => {
    expect(isConnected(snaps[0]!)).toBe(true)
    expect(isConnected(snaps[1]!)).toBe(false)
    expect(isConnected(snaps[2]!)).toBe(true)
    const { connected, popular } = classifyProviders(snaps)
    expect(connected.map((p) => p.id).sort()).toEqual(["my-proxy", "openai"])
    expect(popular.map((p) => p.id)).toEqual(["anthropic"])
  })

  test("filterBuiltInProviders", () => {
    const popular = classifyProviders(snaps).popular
    expect(filterBuiltInProviders(popular, "claude").map((p) => p.id)).toEqual(["anthropic"])
    expect(filterBuiltInProviders(popular, "zzzz")).toEqual([])
  })

  test("primaryBadge", () => {
    expect(primaryBadge(snaps[2]!)).toBe("custom")
    expect(primaryBadge(snaps[0]!)).toBe("api_key")
    expect(primaryBadge(snaps[1]!)).toBeNull()
  })

  test("providerRowSubtitle", () => {
    expect(providerRowSubtitle(snaps[1]!)).toBe("Sign in or enter an API key")

    const apiKeyOnlyCatalog: ProviderSnapshot = {
      id: "groq",
      isCatalog: true,
      supportsLogin: false,
      loginProviderId: null,
      credential: {hasApiKey: false, hasOAuth: false, originKind: "none"},
    }
    expect(providerRowSubtitle(apiKeyOnlyCatalog)).toBe("API key required")

    expect(providerRowSubtitle(snaps[0]!)).toBe("API key set")

    const oauthCatalog: ProviderSnapshot = {
      id: "anthropic",
      isCatalog: true,
      supportsLogin: true,
      loginProviderId: null,
      credential: {hasApiKey: false, hasOAuth: true, originKind: "oauth"},
    }
    expect(providerRowSubtitle(oauthCatalog)).toBe("Signed in with OAuth")

    const bothCatalog: ProviderSnapshot = {
      id: "openrouter",
      isCatalog: true,
      supportsLogin: true,
      loginProviderId: null,
      credential: {hasApiKey: true, hasOAuth: true, originKind: "api_key"},
    }
    expect(providerRowSubtitle(bothCatalog)).toBe("API key set · Signed in with OAuth")

    const customWithConfig: ProviderSnapshot = {
      id: "my-proxy",
      isCatalog: false,
      supportsLogin: false,
      loginProviderId: null,
      baseUrl: "https://api.example.com",
      api: "openai-completions",
      models: [
        {id: "x", name: "x", api: null},
        {id: "y", name: "y", api: null},
      ],
    }
    expect(providerRowSubtitle(customWithConfig)).toBe(
      "https://api.example.com · openai-completions · 2 models · No API key",
    )
  })

  test("shouldShowProviderId hides labels that match after normalizing dashes", () => {
    expect(shouldShowProviderId("amazon-bedrock")).toBe(false)
    expect(shouldShowProviderId("ooioo")).toBe(false)
    expect(shouldShowProviderId("azure")).toBe(true)
  })

  test("parseModelSpec", () => {
    expect(parseModelSpec("openai/gpt-4o")).toEqual({ provider: "openai", model: "gpt-4o" })
    expect(parseModelSpec("")).toEqual({ provider: "", model: "" })
  })

  test("validateProviderId", () => {
    const catalog = new Set(["openai"])
    const customs = new Set(["mine"])
    expect(validateProviderId("", catalog, customs, false)).toBeTruthy()
    expect(validateProviderId("openai", catalog, customs, false)).toMatch(/catalog/)
    expect(validateProviderId("mine", catalog, customs, false)).toMatch(/already/)
    expect(validateProviderId("ok-id", catalog, customs, false)).toBeNull()
    expect(validateProviderId("openai", catalog, customs, true)).toBeNull()
  })
})
