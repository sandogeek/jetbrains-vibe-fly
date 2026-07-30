import { describe, expect, test } from "bun:test"
import type { ProviderSnapshot } from "./providerSnapshots"
import {
  classifyProviders,
  filterBuiltInProviders,
  formatModelsText,
  isConnected,
  parseModelsText,
  parseModelSpec,
  primaryBadge,
  validateProviderId,
} from "./providerLogic"
import { description, displayName } from "./providerLabels"

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
    models: [{ id: "x" }],
  },
]

describe("providerLogic", () => {
  test("displayName and description", () => {
    expect(displayName("openai")).toBe("OpenAI")
    expect(displayName("unknown-x")).toBe("unknown-x")
    expect(description("anthropic")).toBe("Direct access to Claude models")
    expect(description("nope")).toBe("Bundled models from Oh My Pi catalog")
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
    expect(primaryBadge(snaps[1]!)).toBe("configured")
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

  test("parse and format models text", () => {
    const text = `
gpt-4o | GPT-4o | openai-completions
o1
# comment
custom | | anthropic-messages
`.trim()
    const models = parseModelsText(text)
    expect(models).toHaveLength(3)
    expect(models[0]).toEqual({
      id: "gpt-4o",
      name: "GPT-4o",
      api: "openai-completions",
    })
    expect(models[1]).toEqual({ id: "o1", name: undefined, api: undefined })
    expect(models[2]?.api).toBe("anthropic-messages")
    const formatted = formatModelsText([
      { id: "gpt-4o", name: "GPT-4o", api: "openai-completions" },
      { id: "o1" },
    ])
    expect(formatted).toContain("gpt-4o | GPT-4o | openai-completions")
    expect(formatted).toContain("o1")
  })
})
