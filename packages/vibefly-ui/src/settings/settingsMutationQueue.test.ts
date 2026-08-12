import {describe, test} from "node:test"
import {expect} from "expect"
import {settingKeys, setSetting, type SettingMutation} from "@vibefly/uiagent-shared"
import {SettingsMutationQueue} from "./settingsMutationQueue"
import type {UiSettingsRuntime} from "./UiSettingsRuntime"

type FakeRuntime = {
    staged: SettingMutation[][]
    mutated: SettingMutation[][]
    stage: (operations: readonly SettingMutation[]) => void
    mutate: (operations: readonly SettingMutation[]) => Promise<void>
}

function createFakeRuntime(options?: {
    mutateImpl?: (operations: readonly SettingMutation[]) => Promise<void>
}): FakeRuntime {
    const runtime: FakeRuntime = {
        staged: [],
        mutated: [],
        stage(operations) {
            runtime.staged.push([...operations])
        },
        async mutate(operations) {
            runtime.mutated.push([...operations])
            if (options?.mutateImpl) await options.mutateImpl(operations)
        },
    }
    return runtime
}

function asRuntime(fake: FakeRuntime): UiSettingsRuntime {
    return fake as unknown as UiSettingsRuntime
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("SettingsMutationQueue", () => {
    test("merges same-key edits within debounce and saves the last value", async () => {
        const runtime = createFakeRuntime()
        const errors: unknown[] = []
        const queue = new SettingsMutationQueue(() => asRuntime(runtime), (error) => errors.push(error), 30)

        queue.enqueue([setSetting(settingKeys.ui.locale, "en")])
        queue.enqueue([setSetting(settingKeys.ui.locale, "zh")])
        expect(runtime.mutated).toHaveLength(0)
        await wait(50)

        expect(runtime.staged).toHaveLength(2)
        expect(runtime.mutated).toEqual([[setSetting(settingKeys.ui.locale, "zh")]])
        expect(errors).toEqual([])
    })

    test("merges different keys into one save", async () => {
        const runtime = createFakeRuntime()
        const queue = new SettingsMutationQueue(() => asRuntime(runtime), () => undefined, 30)

        queue.enqueue([setSetting(settingKeys.ui.locale, "zh")])
        queue.enqueue([setSetting(settingKeys.commit.customPrompt, "hello")])
        await wait(50)

        expect(runtime.mutated).toEqual([[
            setSetting(settingKeys.ui.locale, "zh"),
            setSetting(settingKeys.commit.customPrompt, "hello"),
        ]])
    })

    test("immediate flushes and clears existing debounce drafts", async () => {
        const runtime = createFakeRuntime()
        const queue = new SettingsMutationQueue(() => asRuntime(runtime), () => undefined, 100)

        queue.enqueue([setSetting(settingKeys.ui.locale, "en")])
        queue.enqueue([
            setSetting(settingKeys.defaultProvider, "openai"),
            setSetting(settingKeys.defaultModel, "gpt-4"),
        ], {immediate: true})
        await wait(0)

        expect(runtime.mutated).toEqual([[
            setSetting(settingKeys.ui.locale, "en"),
            setSetting(settingKeys.defaultProvider, "openai"),
            setSetting(settingKeys.defaultModel, "gpt-4"),
        ]])
        await wait(120)
        expect(runtime.mutated).toHaveLength(1)
    })

    test("edits during an in-flight save are flushed after it completes", async () => {
        let releaseFirst!: () => void
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve
        })
        let mutateCount = 0
        const runtime = createFakeRuntime({
            async mutateImpl() {
                mutateCount += 1
                if (mutateCount === 1) await firstGate
            },
        })
        const queue = new SettingsMutationQueue(() => asRuntime(runtime), () => undefined, 10)

        queue.enqueue([setSetting(settingKeys.commit.customPrompt, "first")], {immediate: true})
        await wait(0)
        queue.enqueue([setSetting(settingKeys.commit.customPrompt, "second")])
        expect(runtime.mutated).toHaveLength(1)

        releaseFirst()
        await wait(30)

        expect(runtime.mutated).toHaveLength(2)
        expect(runtime.mutated[1]).toEqual([setSetting(settingKeys.commit.customPrompt, "second")])
    })

    test("close saves pending debounce mutations", async () => {
        const runtime = createFakeRuntime()
        const queue = new SettingsMutationQueue(() => asRuntime(runtime), () => undefined, 300)

        queue.enqueue([setSetting(settingKeys.ui.locale, "zh")])
        await queue.close()

        expect(runtime.mutated).toEqual([[setSetting(settingKeys.ui.locale, "zh")]])
        queue.enqueue([setSetting(settingKeys.ui.locale, "en")])
        expect(runtime.mutated).toHaveLength(1)
    })

    test("save failure reports once and does not throw from flush", async () => {
        const runtime = createFakeRuntime({
            async mutateImpl() {
                throw new Error("save failed")
            },
        })
        const errors: unknown[] = []
        const queue = new SettingsMutationQueue(
            () => asRuntime(runtime),
            (error) => errors.push(error),
            10,
        )

        queue.enqueue([setSetting(settingKeys.ui.locale, "zh")])
        await wait(30)

        expect(errors).toHaveLength(1)
        expect(String(errors[0])).toContain("save failed")
        await expect(queue.flush()).resolves.toBeUndefined()
    })
})
