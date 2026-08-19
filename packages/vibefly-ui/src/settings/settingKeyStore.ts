import {
    type AgentSettingsInvalidation,
    defaultSettingValues,
    type SettingKey,
    type SettingMutation,
    type SettingMutationRequest,
    type SettingValueResult,
    settingDocumentFile,
    settingMutationId,
} from "@vibefly/uiagent-shared"
import type {Ui2Agent} from "@vibefly/uiagent-shared"
import {ideSettingKeys, type IdeSettings} from "./settingsStore"

export type SettingEntryStatus = "loading" | "ready" | "saving" | "error"

type SettingEntry = {
    value: unknown
    sequence: number
    status: SettingEntryStatus
    error?: string
    listeners: Set<() => void>
}

type AgentSettingsClient = Pick<Ui2Agent, "readSettingValues" | "mutateSettings">

function cloneValue<T>(value: T): T {
    return structuredClone(value)
}

export class SettingKeyStore {
    readonly #entries = new Map<string, SettingEntry>()
    readonly #viewListeners = new Set<() => void>()
    readonly #documentEpochs = new Map<string, number>()
    readonly #inflight = new Map<string, Promise<void>>()
    #diagnostics: string | null = null
    #snapshot: {settings: IdeSettings; diagnostics: string | null}

    constructor(private readonly agent: () => AgentSettingsClient | null) {
        this.#snapshot = {
            settings: defaultSettingValues(ideSettingKeys),
            diagnostics: this.#diagnostics,
        }
    }

    getView(): {settings: IdeSettings; diagnostics: string | null} {
        return this.#snapshot
    }

    readonly subscribe = (listener: () => void): (() => void) => {
        this.#viewListeners.add(listener)
        return () => this.#viewListeners.delete(listener)
    }

    readonly getSnapshot = () => this.getView()

    subscribeKey<T>(key: SettingKey<T>, listener: () => void): () => void {
        const entry = this.#ensureEntry(key)
        entry.listeners.add(listener)
        if (entry.status === "loading") void this.#readKeys([key.id])
        return () => {
            entry.listeners.delete(listener)
            if (entry.listeners.size === 0) this.#entries.delete(key.id)
        }
    }

    bootstrap(keys: readonly SettingKey<unknown>[] = flattenIdeKeys()): Promise<void> {
        for (const key of keys) this.#ensureEntry(key)
        return this.#readKeys(keys.map((key) => key.id))
    }

    handleInvalidation(change: AgentSettingsInvalidation): Promise<void> {
        const documents = new Set(change.changes.map((item) => item.document))
        const keyIds = [...this.#entries.keys()].filter((keyId) => {
            const key = flattenIdeKeys().find((item) => item.id === keyId)
            return key ? documents.has(settingDocumentFile(key.document)) : false
        })
        if (keyIds.length === 0 && this.#entries.size > 0) {
            return this.#readKeys([...this.#entries.keys()])
        }
        if (keyIds.length === 0) return Promise.resolve()
        return this.#readKeys(keyIds)
    }

    async persist(operations: readonly SettingMutation[]): Promise<void> {
        const client = this.agent()
        if (!client) throw new Error("Agent settings client is unavailable")
        for (const operation of operations) {
            const entry = this.#entries.get(settingMutationId(operation))
            if (entry) {
                entry.status = "saving"
                this.#notifyEntry(entry)
            }
        }
        const request: SettingMutationRequest = {
            clientMutationId: crypto.randomUUID(),
            operations: operations.map((operation) => (
                operation.kind === "set"
                    ? {kind: "set", keyId: operation.key.id, value: operation.key.encode(operation.value)}
                    : {kind: "unset", keyId: operation.key.id}
            )),
        }
        const result = await client.mutateSettings(request)
        if (!result.ok) {
            for (const operation of operations) {
                const entry = this.#entries.get(settingMutationId(operation))
                if (!entry) continue
                entry.status = "error"
                entry.error = result.error ?? "Settings save failed"
                this.#notifyEntry(entry)
            }
            throw new Error(result.error ?? "Settings save failed")
        }
        await this.#readKeys(operations.map((operation) => operation.key.id))
    }

    async #readKeys(keyIds: string[]): Promise<void> {
        const unique = [...new Set(keyIds)]
        if (unique.length === 0) return
        const client = this.agent()
        if (!client) return
        const documents = new Set(
            flattenIdeKeys()
                .filter((key) => unique.includes(key.id))
                .map((key) => settingDocumentFile(key.document)),
        )
        for (const document of documents) {
            this.#documentEpochs.set(document, (this.#documentEpochs.get(document) ?? 0) + 1)
        }
        const inflightKey = [...documents].sort().join(",")
        const pending = this.#inflight.get(inflightKey)
        if (pending) {
            await pending
            return this.#readKeys(unique)
        }
        const epochs = new Map(
            [...documents].map((document) => [document, this.#documentEpochs.get(document) ?? 0]),
        )
        const task = this.#readKeysOnce(unique, epochs)
        this.#inflight.set(inflightKey, task)
        try {
            await task
        } finally {
            if (this.#inflight.get(inflightKey) === task) this.#inflight.delete(inflightKey)
        }
        const stale = [...documents].some((document) => {
            return (this.#documentEpochs.get(document) ?? 0) !== epochs.get(document)
        })
        if (stale) await this.#readKeys(unique)
    }

    async #readKeysOnce(
        keyIds: string[],
        epochs: Map<string, number>,
    ): Promise<void> {
        const client = this.agent()
        if (!client) return
        const results = await client.readSettingValues(keyIds)
        for (const result of results) this.#applyResult(result, epochs)
        this.#rebuildView()
    }

    #applyResult(result: SettingValueResult, epochs: Map<string, number>): void {
        const entry = this.#entries.get(result.keyId)
        if (!entry) return
        const epoch = epochs.get(result.document)
        if (epoch != null && epoch !== this.#documentEpochs.get(result.document)) return
        if (result.sequence < entry.sequence) return
        entry.value = cloneValue(result.value)
        entry.sequence = result.sequence
        entry.status = "ready"
        entry.error = undefined
        this.#notifyEntry(entry)
    }

    #ensureEntry<T>(key: SettingKey<T>): SettingEntry {
        const existing = this.#entries.get(key.id)
        if (existing) return existing
        const created: SettingEntry = {
            value: cloneValue(key.decode(undefined)),
            sequence: 0,
            status: "loading",
            listeners: new Set(),
        }
        this.#entries.set(key.id, created)
        return created
    }

    #notifyEntry(entry: SettingEntry): void {
        for (const listener of entry.listeners) listener()
    }

    #rebuildView(): void {
        const next = defaultSettingValues(ideSettingKeys)
        applyTree(ideSettingKeys, next, this.#entries)
        this.#snapshot = {
            settings: next,
            diagnostics: this.#diagnostics,
        }
        for (const listener of this.#viewListeners) listener()
    }
}

function flattenIdeKeys(): SettingKey<unknown>[] {
    return collectKeys(ideSettingKeys)
}

function collectKeys(tree: unknown, collected: SettingKey<unknown>[] = []): SettingKey<unknown>[] {
    if (tree && typeof tree === "object" && "id" in tree && "decode" in tree) {
        collected.push(tree as SettingKey<unknown>)
        return collected
    }
    if (!tree || typeof tree !== "object") return collected
    for (const child of Object.values(tree)) collectKeys(child, collected)
    return collected
}

function applyTree(
    keys: unknown,
    target: Record<string, unknown>,
    entries: Map<string, SettingEntry>,
): void {
    if (keys && typeof keys === "object" && "id" in keys) return
    if (!keys || typeof keys !== "object") return
    for (const [name, node] of Object.entries(keys)) {
        if (node && typeof node === "object" && "id" in node) {
            const entry = entries.get((node as SettingKey<unknown>).id)
            if (entry) target[name] = cloneValue(entry.value)
            continue
        }
        const child = target[name]
        if (child && typeof child === "object" && !Array.isArray(child)) {
            applyTree(node, child as Record<string, unknown>, entries)
        }
    }
}
