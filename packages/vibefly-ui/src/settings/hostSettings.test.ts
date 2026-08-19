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
        expect(runtime.getView().settings.ui.locale).toBe("en")

        await runtime.persist([setSetting(settingKeys.ui.locale, "zh")])
        expect(agent.mutations).toHaveLength(1)
        expect(agent.mutations[0]!.keyId).toBe(settingKeys.ui.locale.id)
        expect(runtime.getView().settings.ui.locale).toBe("zh")
    })

    test("getSnapshot returns a cached view until settings change", async () => {
        const agent = new FakeAgent()
        const runtime = new UiSettingsRuntime(new SettingKeyStore(() => agent as never))
        await runtime.start()
        const first = runtime.getSnapshot()
        const second = runtime.getSnapshot()
        expect(first).toBe(second)
        expect(runtime.store.getSnapshot()).toBe(runtime.store.getSnapshot())

        await runtime.persist([setSetting(settingKeys.ui.locale, "zh")])
        const third = runtime.getSnapshot()
        expect(third).not.toBe(first)
        expect(third).toBe(runtime.getSnapshot())
    })
})
