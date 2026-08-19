import {describe, test} from "node:test"
import {expect} from "expect"
import {settingKeys, setSetting} from "@vibefly/uiagent-shared"
import {SettingKeyStore} from "./settingKeyStore"

class RecordingAgent {
    values = new Map<string, unknown>([
        [settingKeys.ui.locale.id, "follow_ide"],
    ])
    sequence = 1
    mutations: Array<{keyId: string; value?: unknown}> = []
    readSnapshots: unknown[] = []
    #readGate: Promise<void> | null = null
    #releaseRead: (() => void) | null = null

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

    async readSettingValues(keyIds: string[]) {
        const snapshot = new Map(this.values)
        const sequence = this.sequence
        if (this.#readGate) await this.#readGate
        this.readSnapshots.push(snapshot.get(settingKeys.ui.locale.id))
        return keyIds.map((keyId) => ({
            keyId,
            value: snapshot.get(keyId) ?? settingKeys.ui.locale.decode(undefined),
            source: "application" as const,
            document: keyId.startsWith("settings:") ? "settings.json" as const : "settings.vibefly.json" as const,
            revisions: {application: "app-1", project: null},
            sequence,
        }))
    }

    async mutateSettings(request: {operations: Array<{keyId: string; value?: unknown}>}) {
        this.sequence += 1
        for (const operation of request.operations) {
            this.mutations.push(operation)
            if (operation.value !== undefined) this.values.set(operation.keyId, operation.value)
        }
        return {ok: true, clientMutationId: "ok"}
    }
}

describe("SettingKeyStore locale writes", () => {
    test("stage then persist keeps sequential locale clicks", async () => {
        const agent = new RecordingAgent()
        const store = new SettingKeyStore(() => agent as never)
        await store.bootstrap()
        expect(store.getView().settings.ui.locale).toBe("follow_ide")

        store.stage([setSetting(settingKeys.ui.locale, "zh")])
        expect(store.getView().settings.ui.locale).toBe("zh")
        await store.persist([setSetting(settingKeys.ui.locale, "zh")])
        expect(store.getView().settings.ui.locale).toBe("zh")

        store.stage([setSetting(settingKeys.ui.locale, "en")])
        expect(store.getView().settings.ui.locale).toBe("en")
        await store.persist([setSetting(settingKeys.ui.locale, "en")])
        expect(store.getView().settings.ui.locale).toBe("en")
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
        expect(store.getView().settings.ui.locale).toBe("en")

        agent.releaseReads()
        await firstPersist
        await secondPersist
        expect(store.getView().settings.ui.locale).toBe("en")
        expect(agent.values.get(settingKeys.ui.locale.id)).toBe("en")
    })
})
