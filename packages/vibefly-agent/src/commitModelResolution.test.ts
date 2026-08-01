import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { setAgentDir } from "@oh-my-pi/pi-utils"
import { clearOmpRuntimeCache } from "./ompRuntime.js"
import { applyProvidersPatch } from "./providerConfig.js"
import { resolveCommitModel } from "./commitMessage.js"

function tempAgentDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vibefly-commit-model-"))
}

const savedEnv: Record<string, string | undefined> = {}

function setEnv(key: string, value: string | undefined) {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k]
  clearOmpRuntimeCache()
})

describe("resolveCommitModel request + OMP only", () => {
  test("uses request commitModel from agent.db and models.yml", async () => {
    const agentDir = tempAgentDir()
    setAgentDir(agentDir)
    setEnv("PI_CODING_AGENT_DIR", agentDir)
    // Old commit env vars must not affect resolution.
    setEnv("VIBEFLY_DEFAULT_MODEL", "openai/gpt-4o-mini")
    setEnv("VIBEFLY_COMMIT_MODEL", "openai/gpt-4o-mini")
    setEnv("VIBEFLY_COMMIT_API_KEY", "sk-should-not-be-used")
    setEnv("OPENAI_API_KEY", "sk-openai-should-not-be-used")
    setEnv("OPENAI_BASE_URL", "https://should-not-be-used.example/v1")
    setEnv("VIBEFLY_COMMIT_BASE_URL", "https://should-not-be-used.example/v1")
    setEnv("VIBEFLY_COMMIT_API", "openai-completions")

    const patch = await applyProvidersPatch({
      providers: [
        {
          id: "local-proxy",
          baseUrl: "https://llm.example/v1",
          api: "openai-responses",
          auth: "none",
          models: [{ id: "demo-model", name: "demo-model" }],
        },
      ],
      credentials: [
        { provider: "local-proxy", action: "set", apiKey: "sk-from-agent-db" },
      ],
    })
    expect(patch.ok).toBe(true)
    clearOmpRuntimeCache()

    const { model, apiKey } = await resolveCommitModel({
      commitModel: "local-proxy/demo-model",
      defaultModel: "openai/gpt-4o-mini",
    })
    expect(String(model.provider)).toBe("local-proxy")
    expect(String(model.id)).toBe("demo-model")
    expect(model.baseUrl).toContain("llm.example")
    expect(apiKey).toBe("sk-from-agent-db")
  })

  test("falls back to request defaultModel when commitModel empty", async () => {
    const agentDir = tempAgentDir()
    setAgentDir(agentDir)
    setEnv("PI_CODING_AGENT_DIR", agentDir)

    const patch = await applyProvidersPatch({
      providers: [
        {
          id: "local-proxy",
          baseUrl: "https://llm.example/v1",
          api: "openai-responses",
          auth: "none",
          models: [
            { id: "default-model", name: "default-model" },
            { id: "other-model", name: "other-model" },
          ],
        },
      ],
      credentials: [
        { provider: "local-proxy", action: "set", apiKey: "sk-default" },
      ],
    })
    expect(patch.ok).toBe(true)
    clearOmpRuntimeCache()

    const { model, apiKey } = await resolveCommitModel({
      commitModel: "",
      defaultModel: "local-proxy/default-model",
    })
    expect(String(model.provider)).toBe("local-proxy")
    expect(String(model.id)).toBe("default-model")
    expect(apiKey).toBe("sk-default")
  })

  test("prefers commitModel over defaultModel", async () => {
    const agentDir = tempAgentDir()
    setAgentDir(agentDir)
    setEnv("PI_CODING_AGENT_DIR", agentDir)

    const patch = await applyProvidersPatch({
      providers: [
        {
          id: "local-proxy",
          baseUrl: "https://llm.example/v1",
          api: "openai-responses",
          auth: "none",
          models: [
            { id: "default-model", name: "default-model" },
            { id: "commit-model", name: "commit-model" },
          ],
        },
      ],
      credentials: [
        { provider: "local-proxy", action: "set", apiKey: "sk-key" },
      ],
    })
    expect(patch.ok).toBe(true)
    clearOmpRuntimeCache()

    const { model } = await resolveCommitModel({
      commitModel: "local-proxy/commit-model",
      defaultModel: "local-proxy/default-model",
    })
    expect(String(model.id)).toBe("commit-model")
  })

  test("errors when neither commit nor default model is set", async () => {
    const agentDir = tempAgentDir()
    setAgentDir(agentDir)
    setEnv("PI_CODING_AGENT_DIR", agentDir)
    setEnv("VIBEFLY_COMMIT_MODEL", "openai/gpt-4o-mini")
    setEnv("OPENAI_API_KEY", "sk-env")

    await expect(resolveCommitModel({})).rejects.toThrow(/No commit model configured/)
  })

  test("errors when model missing from OMP registry", async () => {
    const agentDir = tempAgentDir()
    setAgentDir(agentDir)
    setEnv("PI_CODING_AGENT_DIR", agentDir)
    clearOmpRuntimeCache()

    await expect(
      resolveCommitModel({ commitModel: "missing/provider-model" }),
    ).rejects.toThrow(/not found/)
  })

  test("custom models coerce auth to none; env API keys are ignored", async () => {
    const agentDir = tempAgentDir()
    setAgentDir(agentDir)
    setEnv("PI_CODING_AGENT_DIR", agentDir)
    setEnv("OPENAI_API_KEY", "sk-env-must-not-apply")
    setEnv("VIBEFLY_COMMIT_API_KEY", "sk-env-must-not-apply")

    // auth "apiKey" would make OMP reject models.yml; Vibe Fly forces "none".
    const patch = await applyProvidersPatch({
      providers: [
        {
          id: "local-proxy",
          baseUrl: "https://llm.example/v1",
          api: "openai-responses",
          auth: "apiKey",
          models: [{ id: "demo-model", name: "demo-model" }],
        },
      ],
      credentials: [
        { provider: "local-proxy", action: "set", apiKey: "sk-from-agent-db" },
      ],
    })
    expect(patch.ok).toBe(true)
    clearOmpRuntimeCache()

    const { model, apiKey } = await resolveCommitModel({
      defaultModel: "local-proxy/demo-model",
    })
    expect(String(model.provider)).toBe("local-proxy")
    expect(String(model.id)).toBe("demo-model")
    // Credential comes from agent.db only, not env.
    expect(apiKey).toBe("sk-from-agent-db")
  })
})
