import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { setAgentDir } from "@oh-my-pi/pi-utils"
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
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

afterEach(() => {
  // leave temp dirs for OS cleanup; avoid clobbering real agent dir
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

describe("models.yml merge / migration", () => {
  test("preserves unknown fields on write", () => {
    const agentDir = tempAgentDir()
    const yml = path.join(agentDir, "models.yml")
    fs.writeFileSync(
      yml,
      `
providers:
  openai:
    baseUrl: https://example.com/v1
    customExtra: keep-me
    headers:
      X-Foo: bar
  other:
    discovery:
      type: ollama
`.trimStart(),
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

  test("migrates models.json to models.yml on first write", () => {
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

    expect(fs.existsSync(path.join(agentDir, "models.yml"))).toBe(true)
    const ymlText = fs.readFileSync(path.join(agentDir, "models.yml"), "utf-8")
    expect(ymlText).toContain("leftover")
    expect(ymlText).toContain("llama3")
  })
})

describe("applyProvidersPatch + AuthStorage", () => {
  test("writes custom provider without apiKey in YAML and stores key in agent.db", async () => {
    const agentDir = tempAgentDir()
    setAgentDir(agentDir)

    const result = await applyProvidersPatch({
      agentDir,
      providers: [
        {
          id: "my-proxy",
          baseUrl: "https://proxy.example/v1",
          api: "openai-responses",
          auth: "none",
          models: [{ id: "gpt-test", name: "gpt-test" }],
        },
      ],
      credentials: [
        { provider: "my-proxy", action: "set", apiKey: "sk-test-secret" },
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()

    const yml = fs.readFileSync(path.join(agentDir, "models.yml"), "utf-8")
    expect(yml).toContain("my-proxy")
    expect(yml).toContain("https://proxy.example/v1")
    expect(yml).toMatch(/auth:\s*none/)
    expect(yml).not.toContain("sk-test-secret")
    expect(yml).not.toMatch(/apiKey:\s*sk-/)

    const auth = await openAuthStorage(agentDir)
    try {
      expect(auth.has("my-proxy")).toBe(true)
      const cred = auth.get("my-proxy")
      expect(cred?.type).toBe("api_key")
      if (cred?.type === "api_key") {
        expect(cred.key).toBe("sk-test-secret")
      }
    } finally {
      auth.close()
    }

    // clear only api key
    const cleared = await applyProvidersPatch({
      agentDir,
      providers: [],
      credentials: [{ provider: "my-proxy", action: "clear" }],
    })
    expect(cleared.ok).toBe(true)

    const auth2 = await openAuthStorage(agentDir)
    try {
      const rows = auth2.listStoredCredentials("my-proxy")
      expect(rows.every((r) => r.credential.type !== "api_key")).toBe(true)
    } finally {
      auth2.close()
    }
  })

  test("forces auth none when patch requests apiKey (keys stay in agent.db)", async () => {
    const agentDir = tempAgentDir()
    setAgentDir(agentDir)

    const result = await applyProvidersPatch({
      agentDir,
      providers: [
        {
          id: "local-grok",
          baseUrl: "http://127.0.0.1:8000/v1",
          api: "openai-responses",
          auth: "apiKey",
          models: [{ id: "grok-4.5", name: "grok-4.5" }],
        },
      ],
      credentials: [
        { provider: "local-grok", action: "set", apiKey: "sk-local" },
      ],
    })
    expect(result.ok).toBe(true)

    const raw = loadRawModelsConfig(agentDir)
    expect((raw.providers as any)["local-grok"].auth).toBe("none")
    expect((raw.providers as any)["local-grok"].apiKey).toBeUndefined()
  })

  test("repairModelsYmlAuthForOmp rewrites auth apiKey without inline key", async () => {
    const agentDir = tempAgentDir()
    setAgentDir(agentDir)
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

    const { repairModelsYmlAuthForOmp } = await import("./providerConfig.js")
    expect(repairModelsYmlAuthForOmp(agentDir)).toBe(true)
    const raw = loadRawModelsConfig(agentDir)
    expect((raw.providers as any)["local-grok"].auth).toBe("none")
    expect(repairModelsYmlAuthForOmp(agentDir)).toBe(false)
  })

  test("empty api key set is a no-op (keep existing)", async () => {
    const agentDir = tempAgentDir()
    setAgentDir(agentDir)

    await applyProvidersPatch({
      agentDir,
      providers: [],
      credentials: [{ provider: "openai", action: "set", apiKey: "sk-keep" }],
    })
    await applyProvidersPatch({
      agentDir,
      providers: [],
      credentials: [{ provider: "openai", action: "set", apiKey: "" }],
    })

    const auth = await openAuthStorage(agentDir)
    try {
      const cred = auth.get("openai")
      expect(cred?.type).toBe("api_key")
      if (cred?.type === "api_key") {
        expect(cred.key).toBe("sk-keep")
      }
    } finally {
      auth.close()
    }
  })
})

describe("catalog + snapshot", () => {
  test("getProvidersSnapshot merges catalog and configured", async () => {
    const agentDir = tempAgentDir()
    setAgentDir(agentDir)
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
    expect(custom.isCatalog).toBe(false)
    expect(custom.isConfigured).toBe(true)
    expect(custom.baseUrl).toContain("127.0.0.1")
    expect((custom.models ?? []).some((m) => m.id === "m1")).toBe(true)

    const catalogProvider = providers.find((p) => p.isCatalog)
    if (catalogProvider) {
      expect(catalogProvider.models ?? []).toEqual([])
    }
  })
})
