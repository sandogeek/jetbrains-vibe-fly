/** Shared pi model/auth runtime used by chat sessions and commit generation. */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {ModelRegistry, ModelRuntime} from "@earendil-works/pi-coding-agent"
import {type Api, type CredentialStore, InMemoryCredentialStore, type Model,} from "@earendil-works/pi-ai"
import {log} from "./log.js"

export type PiRuntime = {
  agentDir: string
  auth: CredentialStore
  modelRuntime: ModelRuntime
  registry: ModelRegistry
  close: () => void
}

let cached: PiRuntime | null = null

function expandHome(value: string): string {
  if (value === "~") return os.homedir()
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

export function resolveAgentDir(agentDir?: string | null): string {
  const raw = (agentDir ?? "").trim()
  if (raw) return path.resolve(expandHome(raw))
  const env = (process.env.PI_CODING_AGENT_DIR || "").trim()
  if (env) return path.resolve(expandHome(env))
  return path.join(os.homedir(), ".pi", "agent")
}

export function applyAgentDirFromEnv(agentDir?: string | null): string {
  const dir = resolveAgentDir(agentDir)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

export async function getPiRuntime(options?: {
  agentDir?: string | null
  credentials?: CredentialStore
  forceNew?: boolean
}): Promise<PiRuntime> {
  const started = performance.now()
  const agentDir = applyAgentDirFromEnv(options?.agentDir)
  const credentialsMatch = !options?.credentials || cached?.auth === options.credentials
  if (!options?.forceNew && cached?.agentDir === agentDir && credentialsMatch) return cached

  if (cached) {
    cached.close()
    cached = null
  }

  const auth = options?.credentials ?? new InMemoryCredentialStore()
  const modelRuntime = await ModelRuntime.create({
    credentials: auth,
    modelsPath: null,
    allowModelNetwork: false,
  })
  const registry = new ModelRegistry(modelRuntime)

  const runtime: PiRuntime = {
    agentDir,
    auth,
    modelRuntime,
    registry,
    close: () => {
      if (cached === runtime) cached = null
    },
  }
  cached = runtime
  log.info("pi runtime ready", {
    agentDir,
    modelsPath: null,
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
