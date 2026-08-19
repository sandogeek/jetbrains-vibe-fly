import {describe, test} from "node:test"
import {expect} from "expect"
import {getSettingKey, settingKeys, setSetting, unsetSetting, type SettingKey} from "@vibefly/uiagent-shared"
import {SettingKeyStore} from "./settingKeyStore"

class RecordingAgent {
    values = new Map<string, unknown>([
        [settingKeys.ui.locale.id, "follow_ide"],
    ])
    sequence = 1
    mutations: Array<{keyId: string; value?: unknown}> = []
    readSnapshots: unknown[] = []
    failNextMutation = false
    #readGate: Promise<void> | null = null
    #releaseRead: (() => void) | null = null
    #mutationGate: Promise<void> | null = null
    #releaseMutation: (() => void) | null = null

    holdReads(): void {
        this.#readGate = new Promise((resolve) => {
            this.#releaseRead = resolve
        })
    }

    releaseReads(): void {
        this.#releaseRead?.()
        this.#readGate = null
        this.#releaseRead = null
    }

    holdMutations(): void {
        this.#mutationGate = new Promise((resolve) => {
            this.#releaseMutation = resolve
        })
    }

    releaseMutations(): void {
        this.#releaseMutation?.()
        this.#mutationGate = null
        this.#releaseMutation = null
    }

    async readSettingValues(keyIds: string[]) {
        const snapshot = new Map(this.values)
        const sequence = this.sequence
        if (this.#readGate) await this.#readGate
        this.readSnapshots.push(snapshot.get(settingKeys.ui.locale.id))
        return keyIds.map((keyId) => {
            const key = getSettingKey(keyId)
            return {
                keyId,
                value: snapshot.has(keyId) ? structuredClone(snapshot.get(keyId)) : key?.decode(undefined),
                source: "application" as const,
                document: keyId.startsWith("settings:") ? "settings.json" as const : "settings.vibefly.json" as const,
                revisions: {application: "app-1", project: null},
                sequence,
            }
        })
    }

    async mutateSettings(request: {operations: Array<{kind?: string; keyId: string; value?: unknown}>}) {
        if (this.#mutationGate) await this.#mutationGate
        if (this.failNextMutation) {
            this.failNextMutation = false
            return {ok: false, clientMutationId: "fail", error: "save failed"}
        }
        this.sequence += 1
        for (const operation of request.operations) {
            this.mutations.push(operation)
            if (operation.kind === "unset") this.values.delete(operation.keyId)
            else this.values.set(operation.keyId, structuredClone(operation.value))
        }
        return {ok: true, clientMutationId: "ok"}
    }
}

type ObjectSetting = {enabled: boolean; count: number}

function objectSettingKey(): SettingKey<ObjectSetting> {
    return {
        id: "vibefly:test.object",
        document: "vibefly",
        path: ["test", "object"],
        decode: (value) => (value as ObjectSetting | undefined) ?? {enabled: false, count: 0},
        encode: (value) => value,
    }
}

describe("SettingKeyStore locale writes", () => {
    test("stage then persist keeps sequential locale clicks", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        await store.bootstrap()
        expect(store.getKey(settingKeys.ui.locale)).toBe("follow_ide")

        store.stage([setSetting(settingKeys.ui.locale, "zh")])
        expect(store.getKey(settingKeys.ui.locale)).toBe("zh")
        await store.persist([setSetting(settingKeys.ui.locale, "zh")])
        expect(store.getKey(settingKeys.ui.locale)).toBe("zh")

        store.stage([setSetting(settingKeys.ui.locale, "en")])
        expect(store.getKey(settingKeys.ui.locale)).toBe("en")
        await store.persist([setSetting(settingKeys.ui.locale, "en")])
        expect(store.getKey(settingKeys.ui.locale)).toBe("en")
        expect(agent.mutations.map((item) => item.value)).toEqual(["zh", "en"])
    })

    test("a stale in-flight read cannot overwrite a newer locale persist", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        await store.bootstrap()

        agent.holdReads()
        const firstPersist = store.persist([setSetting(settingKeys.ui.locale, "zh")])
        await Promise.resolve()
        const secondPersist = store.persist([setSetting(settingKeys.ui.locale, "en")])
        await Promise.resolve()
        expect(store.getKey(settingKeys.ui.locale)).toBe("en")

        agent.releaseReads()
        await firstPersist
        await secondPersist
        expect(store.getKey(settingKeys.ui.locale)).toBe("en")
        expect(agent.values.get(settingKeys.ui.locale.id)).toBe("en")
    })
})

describe("SettingKeyStore per-key snapshots", () => {
    test("getKey returns a stable array reference until a new value is written", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        const beforeSubscribe = store.getKey(settingKeys.modelPreferences.pinnedModelSpecs)
        expect(store.getKey(settingKeys.modelPreferences.pinnedModelSpecs)).toBe(beforeSubscribe)

        store.subscribeKey(settingKeys.modelPreferences.pinnedModelSpecs, () => undefined)
        expect(store.getKey(settingKeys.modelPreferences.pinnedModelSpecs)).toBe(beforeSubscribe)

        await store.bootstrap()
        const confirmed = store.getKey(settingKeys.modelPreferences.pinnedModelSpecs)
        expect(store.getKey(settingKeys.modelPreferences.pinnedModelSpecs)).toBe(confirmed)

        await store.persist([setSetting(settingKeys.modelPreferences.pinnedModelSpecs, ["openai/gpt"])])
        const next = store.getKey(settingKeys.modelPreferences.pinnedModelSpecs)
        expect(next).not.toBe(confirmed)
        expect(next).toEqual(["openai/gpt"])
        expect(store.getKey(settingKeys.modelPreferences.pinnedModelSpecs)).toBe(next)
    })

    test("locale updates do not notify a defaultProvider listener", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        await store.bootstrap()

        const localeNotifications: string[] = []
        const providerNotifications: string[] = []
        store.subscribeKey(settingKeys.ui.locale, () => {
            localeNotifications.push(store.getKey(settingKeys.ui.locale))
        })
        store.subscribeKey(settingKeys.defaultProvider, () => {
            providerNotifications.push(store.getKey(settingKeys.defaultProvider))
        })

        await store.persist([setSetting(settingKeys.ui.locale, "zh")])
        expect(localeNotifications.at(-1)).toBe("zh")
        expect(providerNotifications).toEqual([])
    })

    test("batched mutations notify after both keys have the new pair", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        await store.bootstrap()

        const seen: Array<{provider: string; model: string}> = []
        const recordPair = () => {
            seen.push({
                provider: store.getKey(settingKeys.defaultProvider),
                model: store.getKey(settingKeys.defaultModel),
            })
        }
        store.subscribeKey(settingKeys.defaultProvider, recordPair)
        store.subscribeKey(settingKeys.defaultModel, recordPair)

        await store.persist([
            setSetting(settingKeys.defaultProvider, "openai"),
            setSetting(settingKeys.defaultModel, "gpt-4"),
        ])
        expect(seen.length).toBeGreaterThan(0)
        expect(seen.every((item) => item.provider === "openai" && item.model === "gpt-4")).toBe(true)
    })

    test("unsubscribing the last listener keeps confirmed values", async () => {
        const agent = new RecordingAgent()
        agent.values.set(settingKeys.ui.locale.id, "zh")
        const store = new SettingKeyStore(() => agent as never)
        await store.bootstrap()

        const unsubscribe = store.subscribeKey(settingKeys.ui.locale, () => undefined)
        unsubscribe()
        expect(store.getKey(settingKeys.ui.locale)).toBe("zh")

        store.subscribeKey(settingKeys.ui.locale, () => undefined)
        expect(store.getKey(settingKeys.ui.locale)).toBe("zh")
    })

    test("unsubscribe during persist still applies the confirmed reread", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        await store.bootstrap()
        const unsubscribe = store.subscribeKey(settingKeys.ui.locale, () => undefined)

        agent.holdReads()
        const pending = store.persist([setSetting(settingKeys.ui.locale, "zh")])
        unsubscribe()
        store.subscribeKey(settingKeys.ui.locale, () => undefined)
        agent.releaseReads()
        await pending

        expect(store.getKey(settingKeys.ui.locale)).toBe("zh")
    })

    test("persist failure notifies then restores confirmed values after reread", async () => {
        const agent = new RecordingAgent()
        agent.values.set(settingKeys.ui.locale.id, "en")
        const store = new SettingKeyStore(() => agent as never)
        await store.bootstrap()

        const snapshots: string[] = []
        store.subscribeKey(settingKeys.ui.locale, () => {
            snapshots.push(store.getKey(settingKeys.ui.locale))
        })
        agent.failNextMutation = true
        await expect(store.persist([setSetting(settingKeys.ui.locale, "zh")])).rejects.toThrow("save failed")

        expect(snapshots).toContain("zh")
        expect(store.getKey(settingKeys.ui.locale)).toBe("en")
        expect(snapshots.at(-1)).toBe("en")
    })

    test("invalidation refreshes every leaf of the changed document", async () => {
        const agent = new RecordingAgent()
        agent.values.set(settingKeys.ui.locale.id, "en")
        agent.values.set(settingKeys.commit.languageMode.id, "follow_ide")
        const store = new SettingKeyStore(() => agent as never)
        await store.bootstrap()

        agent.values.set(settingKeys.commit.languageMode.id, "zh")
        await store.handleInvalidation({
            changes: [{scope: "application", document: "settings.vibefly.json", revision: "r2"}],
            sequence: 1,
        })

        expect(store.getKey(settingKeys.commit.languageMode)).toBe("zh")
    })

    test("bootstrap with a null agent keeps defaults until a later bootstrap reads values", async () => {
        let client: RecordingAgent | null = null
        const store = new SettingKeyStore(() => client as never)
        await store.bootstrap()
        expect(store.getKey(settingKeys.ui.locale)).toBe("follow_ide")

        client = new RecordingAgent()
        client.values.set(settingKeys.ui.locale.id, "zh")
        await store.bootstrap()
        expect(store.getKey(settingKeys.ui.locale)).toBe("zh")
    })
})

describe("SettingKeyStore structural equality", () => {
    test("identical primitive mutations do not notify again", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        await store.bootstrap()

        const snapshots: string[] = []
        store.subscribeKey(settingKeys.ui.locale, () => {
            snapshots.push(store.getKey(settingKeys.ui.locale))
        })

        store.stage([setSetting(settingKeys.ui.locale, "follow_ide")])
        expect(snapshots).toEqual([])

        store.stage([setSetting(settingKeys.ui.locale, "zh")])
        expect(snapshots).toEqual(["zh"])
        store.stage([setSetting(settingKeys.ui.locale, "zh")])
        expect(snapshots).toEqual(["zh"])
    })

    test("identical array mutations keep the previous snapshot reference", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        await store.bootstrap()

        const pinned = settingKeys.modelPreferences.pinnedModelSpecs
        await store.persist([setSetting(pinned, ["openai/gpt"])])
        const snapshot = store.getKey(pinned)
        const notifications: string[][] = []
        store.subscribeKey(pinned, () => {
            notifications.push(store.getKey(pinned))
        })

        store.stage([setSetting(pinned, ["openai/gpt"])])
        expect(store.getKey(pinned)).toBe(snapshot)
        expect(notifications).toEqual([])
    })

    test("identical object mutations ignore key insertion order", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        const key = objectSettingKey()

        await store.persist([setSetting(key, {enabled: true, count: 1})])
        const snapshot = store.getKey(key)
        const notifications: ObjectSetting[] = []
        store.subscribeKey(key, () => {
            notifications.push(store.getKey(key))
        })

        await store.persist([setSetting(key, {count: 1, enabled: true})])
        expect(store.getKey(key)).toBe(snapshot)
        expect(notifications).toEqual([])
    })

    test("RPC reread with equal content keeps the snapshot and does not notify", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        const pinned = settingKeys.modelPreferences.pinnedModelSpecs
        await store.bootstrap()
        await store.persist([setSetting(pinned, ["openai/gpt"])])

        const snapshot = store.getKey(pinned)
        let notifications = 0
        store.subscribeKey(pinned, () => {
            notifications += 1
        })

        await store.handleInvalidation({
            changes: [{scope: "application", document: "settings.vibefly.json", revision: "r2"}],
            sequence: 1,
        })
        expect(store.getKey(pinned)).toBe(snapshot)
        expect(notifications).toBe(0)
    })

    test("RPC reread with a new value notifies and replaces the snapshot", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        const pinned = settingKeys.modelPreferences.pinnedModelSpecs
        await store.bootstrap()
        await store.persist([setSetting(pinned, ["openai/gpt"])])

        const snapshot = store.getKey(pinned)
        const notifications: string[][] = []
        store.subscribeKey(pinned, () => {
            notifications.push(store.getKey(pinned))
        })

        agent.values.set(pinned.id, ["anthropic/claude"])
        await store.handleInvalidation({
            changes: [{scope: "application", document: "settings.vibefly.json", revision: "r3"}],
            sequence: 2,
        })

        const next = store.getKey(pinned)
        expect(next).not.toBe(snapshot)
        expect(next).toEqual(["anthropic/claude"])
        expect(notifications).toEqual([["anthropic/claude"]])
    })

    test("unset back to the default value follows structural equality", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        const pinned = settingKeys.modelPreferences.pinnedModelSpecs
        await store.bootstrap()
        const defaultSnapshot = store.getKey(pinned)

        store.stage([unsetSetting(pinned)])
        expect(store.getKey(pinned)).toBe(defaultSnapshot)

        await store.persist([setSetting(pinned, ["openai/gpt"])])
        const setSnapshot = store.getKey(pinned)
        expect(setSnapshot).not.toBe(defaultSnapshot)

        const notifications: string[][] = []
        store.subscribeKey(pinned, () => {
            notifications.push(store.getKey(pinned))
        })
        await store.persist([unsetSetting(pinned)])
        const unsetSnapshot = store.getKey(pinned)
        expect(unsetSnapshot).not.toBe(setSnapshot)
        expect(unsetSnapshot).toEqual([])
        expect(notifications).toEqual([[]])

        store.stage([unsetSetting(pinned)])
        expect(store.getKey(pinned)).toBe(unsetSnapshot)
        expect(notifications).toEqual([[]])
    })

    test("persist still applies an optimistic local write by default", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        await store.bootstrap()

        const snapshots: string[] = []
        store.subscribeKey(settingKeys.ui.locale, () => {
            snapshots.push(store.getKey(settingKeys.ui.locale))
        })
        agent.holdMutations()
        const pending = store.persist([setSetting(settingKeys.ui.locale, "zh")])
        expect(store.getKey(settingKeys.ui.locale)).toBe("zh")
        expect(snapshots).toEqual(["zh"])

        agent.releaseMutations()
        await pending
        expect(store.getKey(settingKeys.ui.locale)).toBe("zh")
        expect(snapshots).toEqual(["zh"])
    })

    test("persist with alreadyStaged does not restage the local value", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        await store.bootstrap()

        agent.holdMutations()
        const skipped = store.persist(
            [setSetting(settingKeys.ui.locale, "zh")],
            {alreadyStaged: true},
        )
        expect(store.getKey(settingKeys.ui.locale)).toBe("follow_ide")
        agent.releaseMutations()
        await skipped
        expect(store.getKey(settingKeys.ui.locale)).toBe("zh")

        const snapshots: string[] = []
        store.subscribeKey(settingKeys.ui.locale, () => {
            snapshots.push(store.getKey(settingKeys.ui.locale))
        })
        store.stage([setSetting(settingKeys.ui.locale, "en")])
        expect(snapshots).toEqual(["en"])
        await store.persist([setSetting(settingKeys.ui.locale, "en")], {alreadyStaged: true})
        expect(store.getKey(settingKeys.ui.locale)).toBe("en")
        expect(snapshots).toEqual(["en"])
    })
})
