import {
    type AgentSettingsInvalidation,
    type SettingKey,
    type SettingMutation,
    type SettingMutationRequest,
    type SettingValueResult,
    settingDocumentFile,
    settingMutationId,
} from "@vibefly/uiagent-shared"
import type {Ui2Agent} from "@vibefly/uiagent-shared"
import {ideSettingKeys} from "./settingsStore"

export type SettingEntryStatus = "loading" | "ready" | "saving" | "error"

type SettingEntry = {
    value: unknown
    /**
     * Last applied Agent sequence for this key. A read result with a smaller
     * sequence is stale or reordered and must be discarded.
     * 该 key 已应用的 Agent sequence。读结果 sequence 更小时视为过期或乱序，丢弃。
     */
    sequence: number
    /**
     * Local optimistic-write generation. Captured at read start; if it changes
     * before the result arrives, that in-flight read must not clobber this value.
     * 本地乐观写入 generation。读取开始时快照；结果返回前若已变化，该在途读取不得覆盖当前值。
     */
    writeGeneration: number
    status: SettingEntryStatus
    error?: string
    listeners: Set<() => void>
}

type AgentSettingsClient = Pick<Ui2Agent, "readSettingValues" | "mutateSettings">

function cloneValue<T>(value: T): T {
    return structuredClone(value)
}

export type SettingPersistOptions = {
    /**
     * Skip the optimistic local write. Use after an explicit `stage()` so the
     * same mutation batch is not applied twice.
     * 跳过本地乐观写入。在已经 `stage()` 之后使用，避免同一批 mutation 被应用两次。
     */
    alreadyStaged?: boolean
}

/**
 * Structural equality for JSON setting values. Object key insertion order is
 * ignored; functions, class instances, and cycles are out of scope.
 * JSON 设置值的结构相等。对象 key 插入顺序不参与比较；不处理函数、类实例或循环引用。
 */
function jsonValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true
    if (left === null || right === null) return false
    if (typeof left !== "object" || typeof right !== "object") return false
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right)) return false
        if (left.length !== right.length) return false
        for (let index = 0; index < left.length; index += 1) {
            if (!jsonValuesEqual(left[index], right[index])) return false
        }
        return true
    }
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const leftKeys = Object.keys(leftRecord)
    const rightKeys = Object.keys(rightRecord)
    if (leftKeys.length !== rightKeys.length) return false
    for (const key of leftKeys) {
        if (!Object.prototype.hasOwnProperty.call(rightRecord, key)) return false
        if (!jsonValuesEqual(leftRecord[key], rightRecord[key])) return false
    }
    return true
}

export class SettingKeyStore {
    readonly #entries = new Map<string, SettingEntry>()
    /**
     * Per-document refresh epoch. Bumped when a read starts; a result whose
     * captured epoch no longer matches is stale and triggers another round.
     * 每个 document 的刷新 epoch。读取开始时递增；结果带回的 epoch 已对不上则过期，再读一轮。
     */
    readonly #documentEpochs = new Map<string, number>()
    /**
     * In-flight bulk read per document. Overlapping reads of the same file wait
     * and retry, so they do not race by bumping each other's epoch.
     * 每个 document 进行中的批量读取。同文件重叠读必须等待后重试，避免互相抬 epoch。
     */
    readonly #inflight = new Map<string, Promise<void>>()
    readonly #defaultValues = new Map<string, unknown>()

    constructor(private readonly agent: () => AgentSettingsClient | null) {
    }

    /**
     * Stable per-key snapshot. Does not create entries or start I/O, so it is safe
     * to call from React render / useSyncExternalStore getSnapshot.
     * 稳定的 per-key 快照。不创建 entry、不发起 I/O，可在 React render /
     * useSyncExternalStore getSnapshot 中调用。
     */
    getKey<T>(key: SettingKey<T>): T {
        const entry = this.#entries.get(key.id)
        return (entry ? entry.value : this.#getDefaultValue(key)) as T
    }

    subscribeKey<T>(key: SettingKey<T>, listener: () => void): () => void {
        const entry = this.#ensureEntry(key)
        entry.listeners.add(listener)
        if (entry.status === "loading") void this.#readKeys([key.id])
        return () => {
            entry.listeners.delete(listener)
        }
    }

    bootstrap(keys: readonly SettingKey<unknown>[] = flattenIdeKeys()): Promise<void> {
        for (const key of keys) this.#ensureEntry(key)
        return this.#readKeys(keys.map((key) => key.id))
    }

    /**
     * Optimistic local write. Bumps writeGeneration so an in-flight read cannot
     * clobber this value if it was started against an older generation.
     * 乐观本地写入。提升 writeGeneration，避免针对旧 generation 的在途读取覆盖本次值。
     */
    stage(operations: readonly SettingMutation[]): void {
        this.#applyLocalMutations(operations, "saving")
    }

    handleInvalidation(change: AgentSettingsInvalidation): Promise<void> {
        const documents = new Set(change.changes.map((item) => item.document))
        const keys = flattenIdeKeys().filter((key) => documents.has(settingDocumentFile(key.document)))
        if (keys.length === 0) {
            if (this.#entries.size === 0) return Promise.resolve()
            return this.#readKeys([...this.#entries.keys()])
        }
        for (const key of keys) this.#ensureEntry(key)
        return this.#readKeys(keys.map((key) => key.id))
    }

    async persist(
        operations: readonly SettingMutation[],
        options?: SettingPersistOptions,
    ): Promise<void> {
        const client = this.agent()
        if (!client) throw new Error("Agent settings client is unavailable")
        if (!options?.alreadyStaged) this.#applyLocalMutations(operations, "saving")
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
            }
            await this.#readKeys(operations.map((operation) => operation.key.id))
            throw new Error(result.error ?? "Settings save failed")
        }
        this.#markReady(operations)
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
        const pending = [...documents]
            .map((document) => this.#inflight.get(document))
            .filter((task): task is Promise<void> => task != null)
        if (pending.length > 0) {
            // Wait on overlapping documents. A per-key read and a bootstrap of the
            // same file must not run together or they keep bumping each other's epoch.
            // 重叠 document 必须串行。单 key read 和同文件 bootstrap 并行会互相抬 epoch。
            await Promise.all(pending)
            return this.#readKeys(unique)
        }
        for (const document of documents) {
            this.#documentEpochs.set(document, (this.#documentEpochs.get(document) ?? 0) + 1)
        }
        const epochs = new Map(
            [...documents].map((document) => [document, this.#documentEpochs.get(document) ?? 0]),
        )
        const writeGenerations = new Map(
            unique.map((keyId) => [keyId, this.#entries.get(keyId)?.writeGeneration ?? 0]),
        )
        const task = this.#readKeysOnce(unique, epochs, writeGenerations)
        for (const document of documents) this.#inflight.set(document, task)
        try {
            await task
        } finally {
            for (const document of documents) {
                if (this.#inflight.get(document) === task) this.#inflight.delete(document)
            }
        }
        const stale = [...documents].some((document) => {
            return (this.#documentEpochs.get(document) ?? 0) !== epochs.get(document)
        })
        if (stale) await this.#readKeys(unique)
    }

    async #readKeysOnce(
        keyIds: string[],
        epochs: Map<string, number>,
        writeGenerations: Map<string, number>,
    ): Promise<void> {
        const client = this.agent()
        if (!client) return
        const results = await client.readSettingValues(keyIds)
        const updated = new Set<SettingEntry>()
        for (const result of results) {
            const entry = this.#applyResult(result, epochs, writeGenerations)
            if (entry) updated.add(entry)
        }
        this.#notifyEntries(updated)
    }

    #applyResult(
        result: SettingValueResult,
        epochs: Map<string, number>,
        writeGenerations: Map<string, number>,
    ): SettingEntry | null {
        const entry = this.#entries.get(result.keyId)
        if (!entry) return null
        const epoch = epochs.get(result.document)
        if (epoch != null && epoch !== this.#documentEpochs.get(result.document)) return null
        if ((writeGenerations.get(result.keyId) ?? 0) !== entry.writeGeneration) return null
        if (result.sequence < entry.sequence) return null
        entry.sequence = result.sequence
        entry.status = "ready"
        entry.error = undefined
        if (jsonValuesEqual(entry.value, result.value)) return null
        entry.value = cloneValue(result.value)
        return entry
    }

    #ensureEntry<T>(key: SettingKey<T>): SettingEntry {
        const existing = this.#entries.get(key.id)
        if (existing) return existing
        const created: SettingEntry = {
            value: this.#getDefaultValue(key),
            sequence: 0,
            writeGeneration: 0,
            status: "loading",
            listeners: new Set(),
        }
        this.#entries.set(key.id, created)
        return created
    }

    #getDefaultValue<T>(key: SettingKey<T>): T {
        if (this.#defaultValues.has(key.id)) {
            return this.#defaultValues.get(key.id) as T
        }
        const created = key.decode(undefined)
        this.#defaultValues.set(key.id, created)
        return created
    }

    #applyLocalMutations(operations: readonly SettingMutation[], status: SettingEntryStatus): void {
        if (operations.length === 0) return
        const updated = new Set<SettingEntry>()
        for (const operation of operations) {
            const entry = this.#ensureEntry(operation.key)
            entry.writeGeneration += 1
            const nextValue = operation.kind === "set"
                ? operation.value
                : this.#getDefaultValue(operation.key)
            if (!jsonValuesEqual(entry.value, nextValue)) {
                entry.value = cloneValue(nextValue)
                updated.add(entry)
            }
            entry.status = status
            entry.error = undefined
        }
        this.#notifyEntries(updated)
    }

    #markReady(operations: readonly SettingMutation[]): void {
        for (const operation of operations) {
            const entry = this.#entries.get(settingMutationId(operation))
            if (!entry) continue
            entry.status = "ready"
            entry.error = undefined
        }
    }

    #notifyEntries(entries: Iterable<SettingEntry>): void {
        const unique = new Set(entries)
        for (const entry of unique) {
            for (const listener of [...entry.listeners]) listener()
        }
    }
}

const IDE_SETTING_KEY_LEAVES: SettingKey<unknown>[] = collectKeys(ideSettingKeys)

function flattenIdeKeys(): readonly SettingKey<unknown>[] {
    return IDE_SETTING_KEY_LEAVES
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
