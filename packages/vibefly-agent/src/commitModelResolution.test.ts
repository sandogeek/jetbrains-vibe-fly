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

describe("resolveCommitModel with OMP agentDir", () => {
  test("reads custom model + api key from agent.db and models.yml", async () => {
    const agentDir = tempAgentDir()
    setAgentDir(agentDir)
    setEnv("PI_CODING_AGENT_DIR", agentDir)
    setEnv("VIBEFLY_DEFAULT_MODEL", "local-proxy/demo-model")
    setEnv("VIBEFLY_COMMIT_MODEL", undefined)
    setEnv("OMP_COMMIT_MODEL", undefined)
    setEnv("VIBEFLY_COMMIT_API_KEY", undefined)
    setEnv("OPENAI_API_KEY", undefined)
    setEnv("OPENAI_BASE_URL", undefined)
    setEnv("VIBEFLY_COMMIT_BASE_URL", undefined)

    const patch = await applyProvidersPatch({
      agentDir,
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

    const { model, apiKey } = await resolveCommitModel()
    expect(String(model.provider)).toBe("local-proxy")
    expect(String(model.id)).toBe("demo-model")
    expect(model.baseUrl).toContain("llm.example")
    expect(apiKey).toBe("sk-from-agent-db")
  })

  test("env VIBEFLY_COMMIT_API_KEY still works as fallback", async () => {
    const agentDir = tempAgentDir()
    setAgentDir(agentDir)
    setEnv("PI_CODING_AGENT_DIR", agentDir)
    setEnv("VIBEFLY_DEFAULT_MODEL", "openai/gpt-4o-mini")
    setEnv("VIBEFLY_COMMIT_MODEL", "openai/gpt-4o-mini")
    setEnv("VIBEFLY_COMMIT_API_KEY", "sk-env-fallback")
    // Ensure no stored key shadows; empty agent.db is fine.
    clearOmpRuntimeCache()

    const { model, apiKey } = await resolveCommitModel()
    expect(String(model.provider)).toBe("openai")
    expect(String(model.id)).toContain("gpt-4o-mini")
    expect(apiKey).toBe("sk-env-fallback")
  })
})
