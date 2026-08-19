import {describe, test} from "node:test"
import {expect} from "expect"
import {
    settingKeys,
    setSetting,
} from "@vibefly/uiagent-shared"
import {SettingKeyStore} from "./settingKeyStore"
import {UiSettingsRuntime} from "./UiSettingsRuntime"

class FakeAgent {
    values = new Map<string, unknown>([
        [settingKeys.ui.locale.id, "en"],
        [settingKeys.defaultProvider.id, ""],
    ])
    mutations: Array<{keyId: string; value?: unknown}> = []
    sequence = 1

    async readSettingValues(keyIds: string[]) {
        return keyIds.map((keyId) => ({
            keyId,
            value: this.values.get(keyId) ?? settingKeys.ui.locale.decode(undefined),
            source: "application" as const,
            document: keyId.startsWith("settings:") ? "settings.json" as const : "settings.vibefly.json" as const,
            revisions: {application: "app-1", project: null},
            sequence: this.sequence,
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

describe("UiSettingsRuntime", () => {
    test("reads confirmed values from Agent and persists typed mutations", async () => {
        const agent = new FakeAgent()
        agent.values.set(settingKeys.ui.locale.id, "en")
        const runtime = new UiSettingsRuntime(new SettingKeyStore(() => agent as never))
        await runtime.start()
        expect(runtime.store.getKey(settingKeys.ui.locale)).toBe("en")

        await runtime.persist([setSetting(settingKeys.ui.locale, "zh")])
        expect(agent.mutations).toHaveLength(1)
        expect(agent.mutations[0]!.keyId).toBe(settingKeys.ui.locale.id)
        expect(runtime.store.getKey(settingKeys.ui.locale)).toBe("zh")
    })

    test("subscribeKey is notified after persist and invalidation", async () => {
        const agent = new FakeAgent()
        const runtime = new UiSettingsRuntime(new SettingKeyStore(() => agent as never))
        await runtime.start()
        const locales: string[] = []
        runtime.store.subscribeKey(settingKeys.ui.locale, () => {
            locales.push(runtime.store.getKey(settingKeys.ui.locale))
        })

        await runtime.persist([setSetting(settingKeys.ui.locale, "zh")])
        expect(locales.at(-1)).toBe("zh")

        agent.values.set(settingKeys.ui.locale.id, "en")
        await runtime.notifyInvalidation({
            changes: [{scope: "application", document: "settings.vibefly.json", revision: "r2"}],
            sequence: 1,
        })
        expect(runtime.store.getKey(settingKeys.ui.locale)).toBe("en")
        expect(locales.at(-1)).toBe("en")
    })
})
