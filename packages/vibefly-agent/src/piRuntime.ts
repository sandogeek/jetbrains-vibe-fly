/** Shared pi model/auth runtime used by chat sessions and commit generation. */
import * as fs from "node:fs"
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent"
import type { Api, Model } from "@earendil-works/pi-ai"
import {
  authJsonPath,
  modelsJsonPath,
  PiAuthStorage,
  repairModelsJsonAuthForPi,
  resolveAgentDir,
} from "./providerConfig.js"
import { log } from "./log.js"

export type PiRuntime = {
  agentDir: string
  auth: PiAuthStorage
  modelRuntime: ModelRuntime
  registry: ModelRegistry
  close: () => void
}

let cached: PiRuntime | null = null

export function applyAgentDirFromEnv(agentDir?: string | null): string {
  const dir = resolveAgentDir(agentDir)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

export async function getPiRuntime(options?: {
  agentDir?: string | null
  forceNew?: boolean
}): Promise<PiRuntime> {
  const started = performance.now()
  const agentDir = applyAgentDirFromEnv(options?.agentDir)
  if (!options?.forceNew && cached?.agentDir === agentDir) return cached

  if (options?.forceNew && cached) {
    cached.close()
    cached = null
  }

  repairModelsJsonAuthForPi(agentDir)
  const auth = new PiAuthStorage(authJsonPath(agentDir))
  const modelRuntime = await ModelRuntime.create({
    credentials: auth,
    authPath: authJsonPath(agentDir),
    modelsPath: modelsJsonPath(agentDir),
  })
  const registry = new ModelRegistry(modelRuntime)
  await registry.refresh()

  const runtime: PiRuntime = {
    agentDir,
    auth,
    modelRuntime,
    registry,
    close: () => {
      if (cached === runtime) cached = null
    },
  }
  if (!options?.forceNew) cached = runtime
  log.info("pi runtime ready", {
    agentDir,
    modelsPath: modelsJsonPath(agentDir),
    modelCount: modelRuntime.getModels().length,
    totalMs: Math.round(performance.now() - started),
  })
  return runtime
}

export function clearPiRuntimeCache(): void {
  cached?.close()
  cached = null
}

export function findPiModel(
  runtime: PiRuntime,
  provider: string,
  modelId: string,
): Model<Api> | undefined {
  return runtime.modelRuntime.getModel(provider, modelId)
}
