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
  const agentDir = applyAgentDirFromEnv(options?.agentDir)
  if (!options?.forceNew && cached && cached.agentDir === agentDir) {
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

  const auth = await openAuthStorage(agentDir)
  const registry = new ModelRegistry(auth, registryModelsPath)

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

  log("omp runtime ready", `agentDir=${agentDir}`, `models=${modelsPath}`)
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
