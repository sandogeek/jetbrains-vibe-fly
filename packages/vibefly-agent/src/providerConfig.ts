/**
 * Oh My Pi provider config bridge: models.yml + AuthStorage (agent.db).
 * Never writes API keys into YAML; only AuthStorage SQLite.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  AuthStorage,
  type AuthCredential,
} from "@oh-my-pi/pi-coding-agent"
import { getAgentDbPath } from "@oh-my-pi/pi-utils"
import { JSONC, YAML } from "bun"
import type {
  CredentialAction,
  ProviderCredentialStatus,
  ProviderModelPatch,
  ProviderModelSnapshot,
  ProviderPatch,
  ProviderRuntimeSnapshot,
  ProvidersPatchRequest,
  ProvidersPatchResult,
  ProvidersSnapshot,
} from "./generated/controlRpc.js"
import { staticProviders } from "./generated/providerCatalog.js"
import { log } from "./log.js"
import {
  resolveLoginProviderId,
} from "./loginProviders.js"

const MANAGED_PROVIDER_KEYS = new Set([
  "baseUrl",
  "api",
  "auth",
  "models",
  "apiKey",
])

type RawModelsFile = {
  providers?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

type RawModelEntry = {
  id?: unknown
  name?: unknown
  api?: unknown
  [key: string]: unknown
}

type ProvidersSnapshotOptions = {
  requestId?: string
}

const providersSnapshotFlights = new Map<string, Promise<ProvidersSnapshot>>()
const providersMutationTails = new Map<string, Promise<void>>()
let providersSnapshotSequence = 0

export function defaultAgentDir(): string {
  return path.join(os.homedir(), ".omp", "agent")
}

export function resolveAgentDir(agentDir?: string | null): string {
  const raw = (agentDir ?? "").trim()
  if (raw) return path.resolve(expandHome(raw))
  const env = (process.env.PI_CODING_AGENT_DIR || "").trim()
  if (env) return path.resolve(expandHome(env))
  return defaultAgentDir()
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir()
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2))
  }
  return p
}

export function modelsYmlPath(agentDir: string): string {
  return path.join(agentDir, "models.yml")
}

export function modelsYamlPath(agentDir: string): string {
  return path.join(agentDir, "models.yaml")
}

export function modelsJsonPath(agentDir: string): string {
  return path.join(agentDir, "models.json")
}

/** Resolve existing models config path; prefer yml > yaml > json. */
export function resolveModelsReadPath(agentDir: string): string | null {
  const yml = modelsYmlPath(agentDir)
  if (fs.existsSync(yml)) return yml
  const yaml = modelsYamlPath(agentDir)
  if (fs.existsSync(yaml)) return yaml
  const json = modelsJsonPath(agentDir)
  if (fs.existsSync(json)) return json
  return null
}

/** Write target is always models.yml (OMP priority). */
export function resolveModelsWritePath(agentDir: string): string {
  return modelsYmlPath(agentDir)
}

export function loadRawModelsConfig(agentDir: string): RawModelsFile {
  const readPath = resolveModelsReadPath(agentDir)
  if (!readPath) return { providers: {} }
  const text = fs.readFileSync(readPath, "utf-8")
  let parsed: unknown
  if (readPath.endsWith(".json") || readPath.endsWith(".jsonc")) {
    parsed = JSONC.parse(text)
  } else {
    parsed = YAML.parse(text)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { providers: {} }
  }
  const data = parsed as RawModelsFile
  if (!data.providers || typeof data.providers !== "object") {
    data.providers = {}
  }
  return data
}

/**
 * OMP rejects custom model lists with auth "apiKey" unless models.yml has an
 * inline apiKey. Vibe Fly never writes keys to YAML, so rewrite those entries
 * to auth "none" (credentials stay in agent.db). Returns true if the file was
 * rewritten.
 */
export function repairModelsYmlAuthForOmp(agentDir: string): boolean {
  const readPath = resolveModelsReadPath(agentDir)
  if (!readPath) return false
  const raw = loadRawModelsConfig(agentDir)
  const providers = raw.providers
  if (!providers) return false

  let changed = false
  for (const entry of Object.values(providers)) {
    if (!entry || typeof entry !== "object") continue
    const models = entry.models
    const hasModels = Array.isArray(models) && models.length > 0
    if (!hasModels) continue
    // Inline apiKey would satisfy OMP, but Vibe Fly policy forbids it.
    if (entry.apiKey != null) {
      delete entry.apiKey
      changed = true
    }
    const auth = asString(entry.auth)
    if (auth !== "none") {
      entry.auth = "none"
      changed = true
    }
  }
  if (!changed) return false
  writeRawModelsConfig(agentDir, raw)
  log.info("repairModelsYmlAuthForOmp", { agentDir })
  return true
}

/**
 * Write models.yml, migrating from models.json on first write when only json exists.
 * Preserves unknown top-level and per-provider fields.
 */
export function writeRawModelsConfig(agentDir: string, data: RawModelsFile): string {
  fs.mkdirSync(agentDir, { recursive: true })
  const writePath = resolveModelsWritePath(agentDir)
  const body = YAML.stringify(data, null, 2)
  fs.writeFileSync(writePath, body.endsWith("\n") ? body : `${body}\n`, "utf-8")
  return writePath
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim()
    return t ? t : undefined
  }
  return undefined
}

function snapshotModels(
  raw: Record<string, unknown> | undefined,
): ProviderModelSnapshot[] {
  const modelsRaw = raw?.models
  if (Array.isArray(modelsRaw) && modelsRaw.length > 0) {
    return modelsRaw
      .map((entry): ProviderModelSnapshot | null => {
        if (!entry || typeof entry !== "object") return null
        const m = entry as RawModelEntry
        const id = asString(m.id)
        if (!id) return null
        return {
          id,
          name: asString(m.name) ?? id,
          api: asString(m.api),
          isCustom: true,
        }
      })
      .filter((m): m is ProviderModelSnapshot => m != null)
  }

  return []
}

function credentialStatus(
  auth: AuthStorage,
  providerId: string,
): ProviderCredentialStatus {
  const stored = auth.listStoredCredentials(providerId)
  let hasApiKey = false
  let hasOAuth = false
  for (const row of stored) {
    if (row.credential.type === "api_key") hasApiKey = true
    if (row.credential.type === "oauth") hasOAuth = true
  }
  // Also surface env/config auth without listing secrets.
  const origin = auth.getCredentialOrigin(providerId)
  const originKind = origin?.kind ?? (hasOAuth ? "oauth" : hasApiKey ? "api_key" : "none")
  if (!hasApiKey && (originKind === "api_key" || originKind === "env" || originKind === "config")) {
    hasApiKey = true
  }
  if (!hasOAuth && originKind === "oauth") {
    hasOAuth = true
  }
  return {
    hasApiKey,
    hasOAuth,
    originKind: String(originKind),
  }
}

export function getProvidersSnapshot(
  agentDirInput?: string | null,
  options: ProvidersSnapshotOptions = {},
): Promise<ProvidersSnapshot> {
  const agentDir = resolveAgentDir(agentDirInput)
  const requestId =
    options.requestId ?? `local-${++providersSnapshotSequence}`
  const mutation = providersMutationTails.get(agentDir)
  if (mutation) {
    log.info("providers snapshot waiting for mutation", {
      requestId,
      agentDir,
    })
    return mutation.then(() =>
      getProvidersSnapshot(agentDir, { ...options, requestId }),
    )
  }
  const existing = providersSnapshotFlights.get(agentDir)
  if (existing) {
    log.info("providers snapshot joined in-flight request", {
      requestId,
      agentDir,
    })
    return existing
  }

  const flight = buildProvidersSnapshot(agentDir, requestId).finally(() => {
    if (providersSnapshotFlights.get(agentDir) === flight) {
      providersSnapshotFlights.delete(agentDir)
    }
  })
  providersSnapshotFlights.set(agentDir, flight)
  return flight
}

function queueProvidersMutation<T>(
  agentDir: string,
  block: () => Promise<T>,
): Promise<T> {
  const previous = providersMutationTails.get(agentDir) ?? Promise.resolve()
  const operation = previous.then(async () => {
    const snapshot = providersSnapshotFlights.get(agentDir)
    if (snapshot) {
      await snapshot.catch(() => undefined)
    }
    return block()
  })
  const tail = operation.then(
    () => undefined,
    () => undefined,
  )
  providersMutationTails.set(agentDir, tail)
  void tail.then(() => {
    if (providersMutationTails.get(agentDir) === tail) {
      providersMutationTails.delete(agentDir)
    }
  })
  return operation
}

async function buildProvidersSnapshot(
  agentDir: string,
  requestId: string,
): Promise<ProvidersSnapshot> {
  const startedAt = performance.now()
  let phase = "prepare"
  let authOpenedAt = 0
  let auth: AuthStorage | null = null
  log.info("providers snapshot start", { requestId, agentDir })
  const authStartedAt = performance.now()
  try {
    fs.mkdirSync(agentDir, { recursive: true })
    auth = await openAuthStorage(agentDir)
    authOpenedAt = performance.now()
    log.info("providers snapshot auth storage ready", {
      requestId,
      agentDir,
      elapsedMs: Math.round(authOpenedAt - authStartedAt),
    })

    const raw = loadRawModelsConfig(agentDir)
    const configured = raw.providers ?? {}
    const ids = new Set<string>([
      ...staticProviders.map((provider) => provider.id),
      ...Object.keys(configured),
    ])

    const providers: ProviderRuntimeSnapshot[] = []
    for (const id of [...ids].sort((a, b) => a.localeCompare(b))) {
      const entry = configured[id]
      const isConfigured = entry != null && typeof entry === "object"
      const rec = isConfigured ? (entry as Record<string, unknown>) : undefined
      const credential = credentialStatus(auth, id)
      if (
        !isConfigured &&
        !credential.hasApiKey &&
        !credential.hasOAuth &&
        credential.originKind === "none"
      ) {
        continue
      }
      providers.push({
        id,
        isConfigured,
        baseUrl: asString(rec?.baseUrl),
        api: asString(rec?.api),
        auth: asString(rec?.auth),
        models: snapshotModels(rec),
        credential,
      })
    }

    const snapshot = {
      agentDir,
      providers,
      modelsPath: resolveModelsReadPath(agentDir) ?? modelsYmlPath(agentDir),
    }
    log.info("providers snapshot done", {
      requestId,
      agentDir,
      runtimeProviders: providers.length,
      authMs: Math.round(authOpenedAt - authStartedAt),
      buildMs: Math.round(performance.now() - authOpenedAt),
      totalMs: Math.round(performance.now() - startedAt),
    })
    return snapshot
  } catch (error) {
    log.warn("providers snapshot failed", {
      requestId,
      agentDir,
      phase,
      elapsedMs: Math.round(performance.now() - startedAt),
      err: error,
    })
    throw error
  } finally {
    auth?.close()
  }
}

function ensureProviderEntry(
  raw: RawModelsFile,
  providerId: string,
): Record<string, unknown> {
  if (!raw.providers) raw.providers = {}
  const existing = raw.providers[providerId]
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as Record<string, unknown>
  }
  const created: Record<string, unknown> = {}
  raw.providers[providerId] = created
  return created
}

function applyProviderPatch(
  raw: RawModelsFile,
  patch: ProviderPatch,
): void {
  const id = patch.id.trim()
  if (!id) throw new Error("Provider id is required")

  if (patch.remove) {
    if (raw.providers && id in raw.providers) {
      delete raw.providers[id]
    }
    return
  }

  const entry = ensureProviderEntry(raw, id)

  if (patch.clearBaseUrl) {
    delete entry.baseUrl
  } else if (patch.baseUrl != null) {
    const v = patch.baseUrl.trim()
    if (v) entry.baseUrl = v
    else delete entry.baseUrl
  }

  if (patch.clearApi) {
    delete entry.api
  } else if (patch.api != null) {
    const v = patch.api.trim()
    if (v) entry.api = v
    else delete entry.api
  }

  if (patch.auth != null) {
    const v = patch.auth.trim()
    if (v) entry.auth = v
    else delete entry.auth
  }

  if (patch.models != null) {
    entry.models = patch.models.map((m: ProviderModelPatch) => {
      const id = m.id.trim()
      if (!id) throw new Error(`Provider ${patch.id}: model id is required`)
      const out: Record<string, unknown> = { id }
      const name = (m.name ?? "").trim()
      if (name) out.name = name
      const api = (m.api ?? "").trim()
      if (api) out.api = api
      // Minimal defaults so OMP validation accepts custom model lists.
      if (!out.name) out.name = id
      if (!("reasoning" in out)) out.reasoning = false
      if (!("input" in out)) out.input = ["text"]
      if (!("cost" in out)) {
        out.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
      if (!("contextWindow" in out)) out.contextWindow = 128000
      if (!("maxTokens" in out)) out.maxTokens = 4096
      return out
    })

    // Custom providers with models: require baseUrl + api + auth none (no plaintext apiKey).
    const hasModels = Array.isArray(entry.models) && (entry.models as unknown[]).length > 0
    if (hasModels) {
      if (!asString(entry.baseUrl)) {
        throw new Error(
          `Provider ${id}: baseUrl is required when defining custom models`,
        )
      }
      if (!asString(entry.api) && !(entry.models as RawModelEntry[]).every((m) => asString(m.api))) {
        throw new Error(
          `Provider ${id}: api is required at provider or model level for custom models`,
        )
      }
      // OMP validates: custom models need inline apiKey OR auth "none".
      // Vibe Fly never writes apiKey to YAML (keys live in agent.db only),
      // so auth must be "none". Agent.db credentials still resolve via AuthStorage.
      entry.auth = "none"
      delete entry.apiKey
    }
  }

  // Drop empty provider objects that only exist as placeholders.
  const keys = Object.keys(entry).filter((k) => entry[k] !== undefined)
  if (keys.length === 0) {
    delete raw.providers![id]
  }
}

async function applyCredentialAction(
  auth: AuthStorage,
  action: CredentialAction,
): Promise<void> {
  const provider = action.provider.trim()
  if (!provider) throw new Error("Credential provider is required")
  const kind = action.action.trim().toLowerCase()

  if (kind === "set") {
    const key = (action.apiKey ?? "").trim()
    if (!key) return // empty field = keep existing
    const credential: AuthCredential = { type: "api_key", key }
    await auth.set(provider, credential)
    return
  }

  if (kind === "clear") {
    // Only remove API-key credentials; keep OAuth rows.
    const rows = auth.listStoredCredentials(provider)
    for (const row of rows) {
      if (row.credential.type === "api_key") {
        await auth.removeCredential(provider, row.id)
      }
    }
    return
  }

  if (kind === "logout") {
    // Remove all credentials (API key + OAuth), same as AuthStorage.logout.
    await auth.logout(provider)
    const loginId = resolveLoginProviderId(provider)
    if (loginId && loginId !== provider) {
      await auth.logout(loginId)
    }
    return
  }

  throw new Error(`Unknown credential action: ${action.action}`)
}

export async function applyProvidersPatch(
  request: ProvidersPatchRequest,
): Promise<ProvidersPatchResult> {
  try {
    const agentDir = resolveAgentDir()
    return await queueProvidersMutation(agentDir, async () => {
      fs.mkdirSync(agentDir, { recursive: true })
      const providerPatches = request.providers ?? []
      const credentialActions = request.credentials ?? []

      let wroteModels = false
      if (providerPatches.length > 0) {
        const raw = loadRawModelsConfig(agentDir)
        // Ensure providers map exists and is mutable.
        if (!raw.providers || typeof raw.providers !== "object") {
          raw.providers = {}
        }
        for (const patch of providerPatches) {
          applyProviderPatch(raw, patch)
        }
        writeRawModelsConfig(agentDir, raw)
        wroteModels = true
      }

      if (credentialActions.length > 0) {
        const auth = await openAuthStorage(agentDir)
        try {
          for (const cred of credentialActions) {
            await applyCredentialAction(auth, cred)
          }
        } finally {
          auth.close()
        }
      }

      const snapshot = await buildProvidersSnapshot(
        agentDir,
        `mutation-${++providersSnapshotSequence}`,
      )
      log.info("applyProvidersPatch ok", {
        agentDir,
        providers: providerPatches.length,
        credentials: credentialActions.length,
        wroteModels,
      })
      return { ok: true, snapshot }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn("applyProvidersPatch failed", { err: message })
    return { ok: false, error: message }
  }
}

/** Test helper: managed field set (documentation / unit tests). */
export function isManagedProviderField(key: string): boolean {
  return MANAGED_PROVIDER_KEYS.has(key)
}

/**
 * AuthStorage.create does not load rows until reload() — always reload after open.
 */
export async function openAuthStorage(agentDir: string): Promise<AuthStorage> {
  const auth = await AuthStorage.create(getAgentDbPath(agentDir))
  await auth.reload()
  return auth
}
