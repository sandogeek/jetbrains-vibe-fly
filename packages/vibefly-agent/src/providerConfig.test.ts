import { afterEach, describe, test } from "node:test"
import { expect } from "expect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  applyProvidersPatch,
  getProvidersSnapshot,
  isManagedProviderField,
  loadRawModelsConfig,
  openAuthStorage,
  resolveAgentDir,
  writeRawModelsConfig,
} from "./providerConfig.js"

function tempAgentDir(prefix = "vibefly-provider-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  process.env.PI_CODING_AGENT_DIR = dir
  return dir
}

afterEach(() => {
  // leave temp dirs for OS cleanup; avoid clobbering real agent dir
  delete process.env.PI_CODING_AGENT_DIR
})

describe("providerConfig paths", () => {
  test("resolveAgentDir expands home and defaults", () => {
    const dir = resolveAgentDir("~/foo-agent")
    expect(dir.startsWith(os.homedir())).toBe(true)
    expect(dir.endsWith("foo-agent")).toBe(true)
  })

  test("isManagedProviderField", () => {
    expect(isManagedProviderField("baseUrl")).toBe(true)
    expect(isManagedProviderField("headers")).toBe(false)
  })
})

describe("models.json merge / migration", () => {
  test("preserves unknown fields on write", () => {
    const agentDir = tempAgentDir()
    const modelsPath = path.join(agentDir, "models.json")
    fs.writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          openai: {
            baseUrl: "https://example.com/v1",
            customExtra: "keep-me",
            headers: { "X-Foo": "bar" },
          },
          other: { discovery: { type: "ollama" } },
        },
      }),
      "utf-8",
    )

    const raw = loadRawModelsConfig(agentDir)
    expect((raw.providers as any).openai.customExtra).toBe("keep-me")
    ;(raw.providers as any).openai.baseUrl = "https://new.example/v1"
    writeRawModelsConfig(agentDir, raw)

    const again = loadRawModelsConfig(agentDir)
    expect((again.providers as any).openai.baseUrl).toBe("https://new.example/v1")
    expect((again.providers as any).openai.customExtra).toBe("keep-me")
    expect((again.providers as any).openai.headers["X-Foo"]).toBe("bar")
    expect((again.providers as any).other.discovery.type).toBe("ollama")
  })

  test("keeps models.json on first write", () => {
    const agentDir = tempAgentDir()
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          custom: {
            baseUrl: "http://localhost:11434/v1",
            api: "openai-completions",
            auth: "none",
            models: [{ id: "llama3", name: "llama3" }],
            leftover: true,
          },
        },
      }),
      "utf-8",
    )

    const raw = loadRawModelsConfig(agentDir)
    expect((raw.providers as any).custom.leftover).toBe(true)
    writeRawModelsConfig(agentDir, raw)

    expect(fs.existsSync(path.join(agentDir, "models.json"))).toBe(true)
    const ymlText = fs.readFileSync(path.join(agentDir, "models.json"), "utf-8")
    expect(ymlText).toContain("leftover")
    expect(ymlText).toContain("llama3")
  })
})

describe("applyProvidersPatch + PiAuthStorage", () => {
  test("writes custom provider without apiKey and stores key in auth.json", async () => {
    const agentDir = tempAgentDir()

    const result = await applyProvidersPatch({
      providers: [
        {
          id: "my-proxy",
          baseUrl: "https://proxy.example/v1",
          api: "openai-responses",
          models: [{ id: "gpt-test", name: "gpt-test" }],
        },
      ],
      credentials: [
        { provider: "my-proxy", action: "set", apiKey: "sk-test-secret" },
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()

    const modelsText = fs.readFileSync(path.join(agentDir, "models.json"), "utf-8")
    expect(modelsText).toContain("my-proxy")
    expect(modelsText).toContain("https://proxy.example/v1")
    expect(modelsText).not.toContain("auth")
    expect(modelsText).not.toContain("sk-test-secret")
    expect(modelsText).not.toMatch(/apiKey:\s*sk-/)

    const auth = await openAuthStorage(agentDir)
    const cred = await auth.read("my-proxy")
    expect(cred?.type).toBe("api_key")
    if (cred?.type === "api_key") {
      expect(cred.key).toBe("sk-test-secret")
    }

    // clear only api key
    const cleared = await applyProvidersPatch({
      providers: [],
      credentials: [{ provider: "my-proxy", action: "clear" }],
    })
    expect(cleared.ok).toBe(true)

    const auth2 = await openAuthStorage(agentDir)
    expect(await auth2.read("my-proxy")).toBeUndefined()
  })

  test("drops the old auth field when patch requests apiKey", async () => {
    const agentDir = tempAgentDir()

    writeRawModelsConfig(agentDir, {
      providers: {
        "local-grok": {
          auth: "apiKey",
          apiKey: "sk-old-inline",
        },
      },
    })

    const result = await applyProvidersPatch({
      providers: [
        {
          id: "local-grok",
          baseUrl: "http://127.0.0.1:8000/v1",
          api: "openai-responses",
          models: [{ id: "grok-4.5", name: "grok-4.5" }],
        },
      ],
      credentials: [
        { provider: "local-grok", action: "set", apiKey: "sk-local" },
      ],
    })
    expect(result.ok).toBe(true)

    const raw = loadRawModelsConfig(agentDir)
    expect((raw.providers as any)["local-grok"].auth).toBeUndefined()
    expect((raw.providers as any)["local-grok"].apiKey).toBeUndefined()
  })

  test("repairModelsJsonAuthForPi removes inline apiKey", async () => {
    const agentDir = tempAgentDir()
    writeRawModelsConfig(agentDir, {
      providers: {
        "local-grok": {
          baseUrl: "http://127.0.0.1:8000/v1",
          api: "openai-responses",
          auth: "apiKey",
          models: [{ id: "grok-4.5", name: "grok-4.5" }],
        },
      },
    })

    const { repairModelsJsonAuthForPi } = await import("./providerConfig.js")
    expect(repairModelsJsonAuthForPi(agentDir)).toBe(true)
    const raw = loadRawModelsConfig(agentDir)
    expect((raw.providers as any)["local-grok"].auth).toBeUndefined()
    expect(repairModelsJsonAuthForPi(agentDir)).toBe(false)
  })

  test("empty api key set is a no-op (keep existing)", async () => {
    const agentDir = tempAgentDir()

    await applyProvidersPatch({
      providers: [],
      credentials: [{ provider: "openai", action: "set", apiKey: "sk-keep" }],
    })
    await applyProvidersPatch({
      providers: [],
      credentials: [{ provider: "openai", action: "set", apiKey: "" }],
    })

    const auth = await openAuthStorage(agentDir)
    const cred = await auth.read("openai")
    expect(cred?.type).toBe("api_key")
    if (cred?.type === "api_key") {
      expect(cred.key).toBe("sk-keep")
    }
  })
})

describe("catalog + snapshot", () => {
  test("coalesces concurrent snapshots for the same agent dir", async () => {
    const agentDir = tempAgentDir()
    const [first, second, third] = await Promise.all([
      getProvidersSnapshot(agentDir),
      getProvidersSnapshot(agentDir),
      getProvidersSnapshot(agentDir),
    ])

    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  test("getProvidersSnapshot returns mutable state for built-in and configured providers", async () => {
    const agentDir = tempAgentDir()
    writeRawModelsConfig(agentDir, {
      providers: {
        "local-custom": {
          baseUrl: "http://127.0.0.1:8080/v1",
          api: "openai-completions",
          auth: "none",
          models: [{ id: "m1", name: "m1" }],
        },
      },
    })

    const snap = await getProvidersSnapshot(agentDir)
    const providers = snap.providers ?? []
    expect(snap.agentDir).toBe(agentDir)
    expect(providers.some((p) => p.id === "local-custom")).toBe(true)
    const custom = providers.find((p) => p.id === "local-custom")!
    expect(custom.isConfigured).toBe(true)
    expect(custom.baseUrl).toContain("127.0.0.1")
    expect((custom.models ?? []).some((m) => m.id === "m1")).toBe(true)

    for (const provider of providers) {
      expect("isCatalog" in provider).toBe(false)
      expect("supportsLogin" in provider).toBe(false)
      expect("loginProviderId" in provider).toBe(false)
    }
  })
})
