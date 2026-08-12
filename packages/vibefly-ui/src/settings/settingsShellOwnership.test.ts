import {describe, test} from "node:test"
import {expect} from "expect"
import type {Dispatch, MutableRefObject, SetStateAction} from "react"
import {settingKeys, setSetting} from "@vibefly/uiagent-shared"
import type {Ui2Host} from "../generated/rpc"
import {releaseSettingsShellOwnership} from "./settingsShellOwnership"
import {SettingsMutationQueue} from "./settingsMutationQueue"
import type {UiProviderSettingsClient} from "./UiProviderSettingsClient"
import type {UiSettingsRuntime} from "./UiSettingsRuntime"

function createStateSlot<T>(initial: T): {
    get: () => T
    set: Dispatch<SetStateAction<T>>
} {
    let value = initial
    return {
        get: () => value,
        set: (update) => {
            value = typeof update === "function" ? (update as (current: T) => T)(value) : update
        },
    }
}

/**
 * Models StrictMode mount lifecycle for the settings shell:
 * setup → cleanup (async queue.close finally) → setup.
 * The old finally must not clear the remounted effect's runtime / host.
 */
describe("SettingsShell ownership under StrictMode remount", () => {
    test("async cleanup from first mount does not wipe second mount ownership", async () => {
        const settingsRuntime: MutableRefObject<UiSettingsRuntime | null> = {current: null}
        const providerClient: MutableRefObject<UiProviderSettingsClient | null> = {current: null}
        const settingsStore = createStateSlot<UiSettingsRuntime | null>(null)
        const ui2Host = createStateSlot<Ui2Host | null>(null)

        // Mount 1 setup
        const runtime1 = {id: "runtime-1"} as unknown as UiSettingsRuntime
        const providers1 = {id: "providers-1"} as unknown as UiProviderSettingsClient
        const host1 = {id: "host-1"} as unknown as Ui2Host
        settingsRuntime.current = runtime1
        providerClient.current = providers1
        settingsStore.set(runtime1)
        ui2Host.set(host1)

        // Mount 1 cleanup schedules async ownership release (after queue.close)
        let peer1Closed = false
        const closeMount1 = Promise.resolve().then(() => {
            peer1Closed = true
            releaseSettingsShellOwnership({
                runtime: runtime1,
                providers: providers1,
                ui2Host: host1,
                settingsRuntime,
                providerClient,
                setSettingsStore: settingsStore.set,
                setUi2Host: ui2Host.set,
            })
        })

        // Mount 2 setup (StrictMode remount) — installs before mount1 finally
        const runtime2 = {id: "runtime-2"} as unknown as UiSettingsRuntime
        const providers2 = {id: "providers-2"} as unknown as UiProviderSettingsClient
        const host2 = {id: "host-2"} as unknown as Ui2Host
        settingsRuntime.current = runtime2
        providerClient.current = providers2
        settingsStore.set(runtime2)
        ui2Host.set(host2)

        await closeMount1

        expect(peer1Closed).toBe(true)
        expect(settingsRuntime.current).toBe(runtime2)
        expect(providerClient.current).toBe(providers2)
        expect(settingsStore.get()).toBe(runtime2)
        expect(ui2Host.get()).toBe(host2)
    })

    test("cleanup clears ownership when this effect still owns the shared refs", () => {
        const settingsRuntime: MutableRefObject<UiSettingsRuntime | null> = {current: null}
        const providerClient: MutableRefObject<UiProviderSettingsClient | null> = {current: null}
        const settingsStore = createStateSlot<UiSettingsRuntime | null>(null)
        const ui2Host = createStateSlot<Ui2Host | null>(null)

        const runtime = {id: "runtime"} as unknown as UiSettingsRuntime
        const providers = {id: "providers"} as unknown as UiProviderSettingsClient
        const host = {id: "host"} as unknown as Ui2Host
        settingsRuntime.current = runtime
        providerClient.current = providers
        settingsStore.set(runtime)
        ui2Host.set(host)

        releaseSettingsShellOwnership({
            runtime,
            providers,
            ui2Host: host,
            settingsRuntime,
            providerClient,
            setSettingsStore: settingsStore.set,
            setUi2Host: ui2Host.set,
        })

        expect(settingsRuntime.current).toBeNull()
        expect(providerClient.current).toBeNull()
        expect(settingsStore.get()).toBeNull()
        expect(ui2Host.get()).toBeNull()
    })

    test("effect-local queue close flushes the old runtime, not the remounted one", async () => {
        type FakeRuntime = {
            staged: unknown[]
            mutated: unknown[]
            stage: (ops: readonly unknown[]) => void
            mutate: (ops: readonly unknown[]) => Promise<void>
        }

        function createFakeRuntime(): FakeRuntime {
            const runtime: FakeRuntime = {
                staged: [],
                mutated: [],
                stage(ops) {
                    runtime.staged.push(...ops)
                },
                async mutate(ops) {
                    runtime.mutated.push(...ops)
                },
            }
            return runtime
        }

        // Mount 1: local runtime + queue (mirrors SettingsShell effect locals)
        let runtime1: FakeRuntime | null = createFakeRuntime()
        const queue1 = new SettingsMutationQueue(
            () => runtime1 as unknown as UiSettingsRuntime | null,
            () => undefined,
            300,
        )
        queue1.enqueue([setSetting(settingKeys.ui.locale, "zh")])

        // Mount 1 cleanup + Mount 2 setup (StrictMode)
        const runtime2 = createFakeRuntime()
        let runtime2Local: FakeRuntime | null = runtime2
        const queue2 = new SettingsMutationQueue(
            () => runtime2Local as unknown as UiSettingsRuntime | null,
            () => undefined,
            300,
        )

        // Close old queue with effect-local capture; remount must not receive the flush
        await queue1.close()

        expect(runtime1!.mutated).toEqual([setSetting(settingKeys.ui.locale, "zh")])
        expect(runtime2.mutated).toEqual([])

        // New queue still works independently
        queue2.enqueue([setSetting(settingKeys.ui.locale, "en")], {immediate: true})
        await queue2.flush()
        expect(runtime2.mutated).toEqual([setSetting(settingKeys.ui.locale, "en")])
        expect(runtime1!.mutated).toHaveLength(1)
    })
})
