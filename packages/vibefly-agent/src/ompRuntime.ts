/**
 * Shared Oh My Pi AuthStorage + ModelRegistry for commit generation and sessions.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import {
  AuthStorage,
  ModelRegistry,
} from "@oh-my-pi/pi-coding-agent"
import type { Model } from "@oh-my-pi/pi-ai"
import { setAgentDir } from "@oh-my-pi/pi-utils"
import {
  modelsYmlPath,
  openAuthStorage,
  repairModelsYmlAuthForOmp,
  resolveAgentDir,
  resolveModelsReadPath,
} from "./providerConfig.js"
import { log } from "./log.js"

export type OmpRuntime = {
  agentDir: string
  auth: AuthStorage
  registry: ModelRegistry
  close: () => void
}

let cached: OmpRuntime | null = null

/**
 * Ensure PI_CODING_AGENT_DIR / setAgentDir is applied before any OMP path reads.
 * Safe to call multiple times.
 */
export function applyAgentDirFromEnv(agentDir?: string | null): string {
  const dir = resolveAgentDir(agentDir)
  setAgentDir(dir)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Create (or reuse) AuthStorage + ModelRegistry for the active agent dir.
 * Call close() when done if you requested a dedicated instance via forceNew.
 */
export async function getOmpRuntime(options?: {
  agentDir?: string | null
  forceNew?: boolean
}): Promise<OmpRuntime> {
  const started = performance.now()
  const agentDir = applyAgentDirFromEnv(options?.agentDir)
  if (!options?.forceNew && cached && cached.agentDir === agentDir) {
    log.info("omp runtime cache hit", {
      agentDir,
      elapsedMs: Math.round(performance.now() - started),
    })
    return cached
  }

  if (cached && options?.forceNew) {
    try {
      cached.close()
    } catch {
      // ignore
    }
    cached = null
  }

  const modelsPath =
    resolveModelsReadPath(agentDir) ?? modelsYmlPath(agentDir)
  // Prefer yml path for ModelRegistry so JSON→YAML migration can run.
  const registryModelsPath = path.join(agentDir, "models.yml")

  // Custom models + auth apiKey without inline key fail OMP validation.
  // Normalize before ModelRegistry loads so local/custom providers resolve.
  const repairStarted = performance.now()
  const repaired = repairModelsYmlAuthForOmp(agentDir)
  const repairMs = Math.round(performance.now() - repairStarted)

  const authStarted = performance.now()
  const auth = await openAuthStorage(agentDir)
  const authMs = Math.round(performance.now() - authStarted)

  const registryStarted = performance.now()
  const registry = new ModelRegistry(auth, registryModelsPath)
  const registryMs = Math.round(performance.now() - registryStarted)

  const runtime: OmpRuntime = {
    agentDir,
    auth,
    registry,
    close: () => {
      try {
        auth.close()
      } catch {
        // ignore
      }
      if (cached === runtime) cached = null
    },
  }

  if (!options?.forceNew) {
    cached = runtime
  }

  log.info("omp runtime ready", {
    agentDir,
    models: modelsPath,
    repaired,
    repairMs,
    authMs,
    registryMs,
    totalMs: Math.round(performance.now() - started),
  })
  return runtime
}

export function clearOmpRuntimeCache(): void {
  if (cached) {
    try {
      cached.close()
    } catch {
      // ignore
    }
    cached = null
  }
}
