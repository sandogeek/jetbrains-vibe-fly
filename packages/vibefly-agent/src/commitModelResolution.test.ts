import {afterEach, describe, test} from "node:test"
import {expect} from "expect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {clearPiRuntimeCache, getPiRuntime} from "./piRuntime.js"
import {resolveCommitModel} from "./commitMessage.js"

const savedEnv: Record<string, string | undefined> = {}

function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

async function configureModel(
    provider: string,
    modelIds: string[],
    apiKey: string,
): Promise<void> {
  const runtime = await getPiRuntime()
  runtime.modelRuntime.registerProvider(provider, {
    baseUrl: "https://llm.example/v1",
    api: "openai-responses",
    models: modelIds.map((id) => ({
      id,
      name: id,
      reasoning: false,
      input: ["text"],
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
      contextWindow: 128_000,
      maxTokens: 16_384,
    })),
  })
  await runtime.auth.modify(provider, async () => ({type: "api_key", key: apiKey}))
  await runtime.modelRuntime.refresh({allowNetwork: false})
}

function useTempAgentDir(): void {
  setEnv("PI_CODING_AGENT_DIR", fs.mkdtempSync(path.join(os.tmpdir(), "vibefly-commit-model-")))
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const key of Object.keys(savedEnv)) delete savedEnv[key]
  clearPiRuntimeCache()
})

describe("resolveCommitModel request + Host-backed pi runtime", () => {
  test("uses the selected in-memory model and credential while ignoring old env config", async () => {
    useTempAgentDir()
    setEnv("VIBEFLY_COMMIT_API_KEY", "sk-ignored")
    setEnv("OPENAI_API_KEY", "sk-ignored")
    await configureModel("local-proxy", ["demo-model"], "sk-host")

    const { model, apiKey } = await resolveCommitModel({
      commitModel: "local-proxy/demo-model",
      defaultModel: "openai/gpt-4o-mini",
    })
    expect(`${model.provider}/${model.id}`).toBe("local-proxy/demo-model")
    expect(model.baseUrl).toBe("https://llm.example/v1")
    expect(apiKey).toBe("sk-host")
  })

  test("falls back to defaultModel and otherwise prefers commitModel", async () => {
    useTempAgentDir()
    await configureModel("local-proxy", ["default-model", "commit-model"], "sk-host")

    const fallback = await resolveCommitModel({defaultModel: "local-proxy/default-model"})
    expect(fallback.model.id).toBe("default-model")
    const preferred = await resolveCommitModel({
      commitModel: "local-proxy/commit-model",
      defaultModel: "local-proxy/default-model",
    })
    expect(preferred.model.id).toBe("commit-model")
  })

  test("reports missing configuration and unknown models", async () => {
    useTempAgentDir()
    await expect(resolveCommitModel({})).rejects.toThrow(/No commit model configured/)
    await expect(
      resolveCommitModel({ commitModel: "missing/provider-model" }),
    ).rejects.toThrow(/not found/)
  })
})
