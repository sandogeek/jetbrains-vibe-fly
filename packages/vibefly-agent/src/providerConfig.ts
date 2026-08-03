/**
 * pi provider configuration bridge.
 *
 * Model definitions live in models.json and credentials live in auth.json.
 * Secrets are never written to models.json.
 */
import * as fs from "node:fs"
import { createRequire } from "node:module"
import * as os from "node:os"
import * as path from "node:path"
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai"
import { parse as parseJsonc } from "jsonc-parser"
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
import { resolveLoginProviderId } from "./loginProviders.js"

const MANAGED_PROVIDER_KEYS = new Set(["baseUrl", "api", "models"])

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

type ProvidersSnapshotOptions = { requestId?: string }

type AuthLockRelease = () => Promise<void> | void
type AuthLockFile = {
  lockSync: (filePath: string, options?: { realpath?: boolean }) => AuthLockRelease
  lock: (filePath: string, options?: Record<string, unknown>) => Promise<AuthLockRelease>
}

const authLockfile = createRequire(import.meta.url)("proper-lockfile") as AuthLockFile
const AUTH_LOCK_OPTIONS = {
  realpath: false,
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 10_000,
    randomize: true,
  },
  stale: 30_000,
}

/** Small app-owned auth.json store implementing pi-ai's CredentialStore. */
export class PiAuthStorage implements CredentialStore {
  #data: Record<string, Credential> = {}

  constructor(readonly authPath: string) {
    this.reload()
  }

  reload(): void {
    try {
      this.#ensureFile()
      const release = authLockfile.lockSync(this.authPath, { realpath: false })
      try {
        this.#data = this.#read()
      } finally {
        release()
      }
    } catch {
      // Preserve the last valid in-memory snapshot when the file is temporarily unavailable.
    }
  }

  async read(provider: string): Promise<Credential | undefined> {
    return this.#data[provider]
  }

  async modify(
    provider: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.#withLock(async () => {
      const current = this.#read()
      const next = await fn(current[provider])
      if (next === undefined) {
        this.#data = current
        return current[provider]
      }
      const merged = { ...current, [provider]: next }
      this.#data = merged
      this.#write(merged)
      return next
    })
  }

  async delete(provider: string): Promise<void> {
    await this.#withLock(async () => {
      const current = this.#read()
      delete current[provider]
      this.#data = current
      this.#write(current)
    })
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(this.#data).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }))
  }

  #ensureFile(): void {
    fs.mkdirSync(path.dirname(this.authPath), { recursive: true, mode: 0o700 })
    if (!fs.existsSync(this.authPath)) {
      fs.writeFileSync(this.authPath, "{}\n", { encoding: "utf-8", mode: 0o600 })
    }
  }

  #read(): Record<string, Credential> {
    const parsed = JSON.parse(fs.readFileSync(this.authPath, "utf-8")) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Invalid pi auth file: ${this.authPath}`)
    }
    return parsed as Record<string, Credential>
  }

  #write(data: Record<string, Credential>): void {
    fs.writeFileSync(this.authPath, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    })
  }

  async #withLock<T>(block: () => Promise<T>): Promise<T> {
    this.#ensureFile()
    const release = await authLockfile.lock(this.authPath, AUTH_LOCK_OPTIONS)
    try {
      return await block()
    } finally {
      await release()
    }
  }
}

const providersSnapshotFlights = new Map<string, Promise<ProvidersSnapshot>>()
const providersMutationTails = new Map<string, Promise<void>>()
let providersSnapshotSequence = 0

export function defaultAgentDir(): string {
  return path.join(os.homedir(), ".pi", "agent")
}

export function resolveAgentDir(agentDir?: string | null): string {
  const raw = (agentDir ?? "").trim()
  if (raw) return path.resolve(expandHome(raw))
  const env = (process.env.PI_CODING_AGENT_DIR || "").trim()
  if (env) return path.resolve(expandHome(env))
  return defaultAgentDir()
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir()
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

export function modelsJsonPath(agentDir: string): string {
  return path.join(agentDir, "models.json")
}

export function authJsonPath(agentDir: string): string {
  return path.join(agentDir, "auth.json")
}

export function resolveModelsReadPath(agentDir: string): string | null {
  const file = modelsJsonPath(agentDir)
  return fs.existsSync(file) ? file : null
}

export function resolveModelsWritePath(agentDir: string): string {
  return modelsJsonPath(agentDir)
}

export function loadRawModelsConfig(agentDir: string): RawModelsFile {
  const readPath = resolveModelsReadPath(agentDir)
  if (!readPath) return { providers: {} }
  const parsed = parseJsonc(fs.readFileSync(readPath, "utf-8")) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { providers: {} }
  }
  const data = parsed as RawModelsFile
  if (!data.providers || typeof data.providers !== "object" || Array.isArray(data.providers)) {
    data.providers = {}
  }
  return data
}

/** Remove fields from the legacy config format that pi does not understand. */
export function repairModelsJsonAuthForPi(agentDir: string): boolean {
  const readPath = resolveModelsReadPath(agentDir)
  if (!readPath) return false
  const raw = loadRawModelsConfig(agentDir)
  let changed = false
  for (const entry of Object.values(raw.providers ?? {})) {
    if (!entry || typeof entry !== "object") continue
    if ("auth" in entry) {
      delete entry.auth
      changed = true
    }
    if ("apiKey" in entry) {
      delete entry.apiKey
      changed = true
    }
  }
  if (!changed) return false
  writeRawModelsConfig(agentDir, raw)
  log.info("repairModelsJsonAuthForPi", { agentDir })
  return true
}

export function writeRawModelsConfig(agentDir: string, data: RawModelsFile): string {
  fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 })
  const writePath = resolveModelsWritePath(agentDir)
  const body = `${JSON.stringify(data, null, 2)}\n`
  fs.writeFileSync(writePath, body, { encoding: "utf-8", mode: 0o600 })
  return writePath
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function snapshotModels(raw: Record<string, unknown> | undefined): ProviderModelSnapshot[] {
  const models = raw?.models
  if (!Array.isArray(models)) return []
  return models
    .map((entry): ProviderModelSnapshot | null => {
      if (!entry || typeof entry !== "object") return null
      const model = entry as RawModelEntry
      const id = asString(model.id)
      if (!id) return null
      return {
        id,
        name: asString(model.name) ?? id,
        api: asString(model.api),
        isCustom: true,
      }
    })
    .filter((model): model is ProviderModelSnapshot => model !== null)
}

async function credentialStatus(
  auth: PiAuthStorage,
  providerId: string,
): Promise<ProviderCredentialStatus> {
  const stored = await auth.list()
  const storedCredential = stored.find((item) => item.providerId === providerId)
  const hasApiKey = storedCredential?.type === "api_key"
  const hasOAuth = storedCredential?.type === "oauth"
  const originKind = hasOAuth ? "oauth" : hasApiKey ? "api_key" : "none"
  return {
    hasApiKey,
    hasOAuth,
    originKind,
  }
}

export function getProvidersSnapshot(
  agentDirInput?: string | null,
  options: ProvidersSnapshotOptions = {},
): Promise<ProvidersSnapshot> {
  const agentDir = resolveAgentDir(agentDirInput)
  const requestId = options.requestId ?? `local-${++providersSnapshotSequence}`
  const mutation = providersMutationTails.get(agentDir)
  if (mutation) {
    return mutation.then(() => getProvidersSnapshot(agentDir, { ...options, requestId }))
  }
  const existing = providersSnapshotFlights.get(agentDir)
  if (existing) return existing
  const flight = buildProvidersSnapshot(agentDir, requestId).finally(() => {
    if (providersSnapshotFlights.get(agentDir) === flight) {
      providersSnapshotFlights.delete(agentDir)
    }
  })
  providersSnapshotFlights.set(agentDir, flight)
  return flight
}

function queueProvidersMutation<T>(agentDir: string, block: () => Promise<T>): Promise<T> {
  const previous = providersMutationTails.get(agentDir) ?? Promise.resolve()
  const operation = previous.then(async () => {
    const snapshot = providersSnapshotFlights.get(agentDir)
    if (snapshot) await snapshot.catch(() => undefined)
    return block()
  })
  const tail = operation.then(() => undefined, () => undefined)
  providersMutationTails.set(agentDir, tail)
  void tail.then(() => {
    if (providersMutationTails.get(agentDir) === tail) providersMutationTails.delete(agentDir)
  })
  return operation
}

async function buildProvidersSnapshot(
  agentDir: string,
  requestId: string,
): Promise<ProvidersSnapshot> {
  const started = performance.now()
  fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 })
  const auth = await openAuthStorage(agentDir)
  try {
    const raw = loadRawModelsConfig(agentDir)
    const configured = raw.providers ?? {}
    const ids = new Set([
      ...staticProviders.map((provider) => provider.id),
      ...Object.keys(configured),
    ])
    const providers: ProviderRuntimeSnapshot[] = []
    for (const id of [...ids].sort((a, b) => a.localeCompare(b))) {
      const entry = configured[id]
      const isConfigured = Boolean(entry && typeof entry === "object")
      const record = isConfigured ? entry : undefined
      const credential = await credentialStatus(auth, id)
      if (!isConfigured && !credential.hasApiKey && !credential.hasOAuth) continue
      providers.push({
        id,
        isConfigured,
        baseUrl: asString(record?.baseUrl),
        api: asString(record?.api),
        models: snapshotModels(record),
        credential,
      })
    }
    const snapshot: ProvidersSnapshot = {
      agentDir,
      providers,
      modelsPath: resolveModelsReadPath(agentDir) ?? modelsJsonPath(agentDir),
    }
    log.info("providers snapshot done", {
      requestId,
      agentDir,
      providers: providers.length,
      totalMs: Math.round(performance.now() - started),
    })
    return snapshot
  } finally {
    // AuthStorage is file-backed and has no open handle to close.
  }
}

function ensureProviderEntry(raw: RawModelsFile, providerId: string): Record<string, unknown> {
  raw.providers ??= {}
  const current = raw.providers[providerId]
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current
  }
  const created: Record<string, unknown> = {}
  raw.providers[providerId] = created
  return created
}

function applyProviderPatch(raw: RawModelsFile, patch: ProviderPatch): void {
  const id = patch.id.trim()
  if (!id) throw new Error("Provider id is required")
  if (patch.remove) {
    delete raw.providers?.[id]
    return
  }

  const entry = ensureProviderEntry(raw, id)
  if (patch.clearBaseUrl) delete entry.baseUrl
  else if (patch.baseUrl != null) {
    const value = patch.baseUrl.trim()
    if (value) entry.baseUrl = value
    else delete entry.baseUrl
  }
  if (patch.clearApi) delete entry.api
  else if (patch.api != null) {
    const value = patch.api.trim()
    if (value) entry.api = value
    else delete entry.api
  }

  // `auth` and `apiKey` belonged to the old config format. pi resolves both
  // API keys and OAuth credentials from auth.json instead.
  delete entry.auth
  delete entry.apiKey

  if (patch.models != null) {
    entry.models = patch.models.map((model: ProviderModelPatch) => {
      const modelId = model.id.trim()
      if (!modelId) throw new Error(`Provider ${id}: model id is required`)
      const output: Record<string, unknown> = {
        id: modelId,
        name: (model.name ?? "").trim() || modelId,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      }
      const api = (model.api ?? "").trim()
      if (api) output.api = api
      return output
    })
    const models = entry.models as RawModelEntry[]
    if (models.length > 0) {
      if (!asString(entry.baseUrl)) {
        throw new Error(`Provider ${id}: baseUrl is required when defining custom models`)
      }
      if (!asString(entry.api) && !models.every((model) => asString(model.api))) {
        throw new Error(`Provider ${id}: api is required at provider or model level for custom models`)
      }
    }
  }

  if (Object.keys(entry).length === 0) delete raw.providers![id]
}

async function applyCredentialAction(auth: PiAuthStorage, action: CredentialAction): Promise<void> {
  const provider = action.provider.trim()
  if (!provider) throw new Error("Credential provider is required")
  const kind = action.action.trim().toLowerCase()
  if (kind === "set") {
    const key = (action.apiKey ?? "").trim()
    if (!key) return
    await auth.modify(provider, async () => ({ type: "api_key", key }))
    return
  }
  if (kind === "clear") {
    const rows = await auth.list()
    if (rows.some((row: CredentialInfo) => row.providerId === provider && row.type === "api_key")) {
      await auth.delete(provider)
    }
    return
  }
  if (kind === "logout") {
    await auth.delete(provider)
    const loginId = resolveLoginProviderId(provider)
    if (loginId && loginId !== provider) await auth.delete(loginId)
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
      fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 })
      const providerPatches = request.providers ?? []
      const credentialActions = request.credentials ?? []
      let wroteModels = false
      if (providerPatches.length > 0) {
        const raw = loadRawModelsConfig(agentDir)
        for (const patch of providerPatches) applyProviderPatch(raw, patch)
        writeRawModelsConfig(agentDir, raw)
        wroteModels = true
      }
      if (credentialActions.length > 0) {
        const auth = await openAuthStorage(agentDir)
        for (const action of credentialActions) await applyCredentialAction(auth, action)
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

export function isManagedProviderField(key: string): boolean {
  return MANAGED_PROVIDER_KEYS.has(key)
}

export async function openAuthStorage(agentDir: string): Promise<PiAuthStorage> {
  return new PiAuthStorage(authJsonPath(agentDir))
}

export type { Credential }
