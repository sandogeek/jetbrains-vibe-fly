import type {Dispatch, RefObject, SetStateAction} from "react"
import type {Ui2Host} from "../generated/rpc"
import type {UiProviderSettingsClient} from "./UiProviderSettingsClient"
import type {UiSettingsRuntime} from "./UiSettingsRuntime"

/**
 * Drop shared shell ownership only when refs/state still point at this effect's instances.
 * Prevents StrictMode's async cleanup (queue.close finally) from wiping a remounted runtime.
 * 仅当 ref/state 仍指向本 effect 实例时才放弃共享 shell 所有权。
 * 防止 StrictMode 异步 cleanup（queue.close 的 finally）抹掉已 remount 的 runtime。
 */
export function releaseSettingsShellOwnership(options: {
    runtime: UiSettingsRuntime | null
    providers: UiProviderSettingsClient | null
    ui2Host: Ui2Host | null
    settingsRuntime: RefObject<UiSettingsRuntime | null>
    providerClient: RefObject<UiProviderSettingsClient | null>
    setSettingsStore: Dispatch<SetStateAction<UiSettingsRuntime | null>>
    setUi2Host: Dispatch<SetStateAction<Ui2Host | null>>
}): void {
    if (options.settingsRuntime.current === options.runtime) {
        options.settingsRuntime.current = null
    }
    if (options.providerClient.current === options.providers) {
        options.providerClient.current = null
    }
    options.setSettingsStore((current) => (current === options.runtime ? null : current))
    options.setUi2Host((current) => (current === options.ui2Host ? null : current))
}
