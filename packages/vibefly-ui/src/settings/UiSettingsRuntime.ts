import {type AgentSettingsInvalidation, type SettingMutation} from "@vibefly/uiagent-shared"
import {useSyncExternalStore} from "react"
import type {IdeSettings} from "./settingsStore"
import {SettingKeyStore} from "./settingKeyStore"

export type UiSettingsView = {
    settings: IdeSettings
    diagnostics: string | null
    applicationRevision: string
}

/**
 * Agent-backed settings runtime. Confirmed values come from SettingKeyStore.
 */
export class UiSettingsRuntime {
    readonly store: SettingKeyStore
    #modelsRevision = ""
    readonly #revisionListeners = new Set<(revision: string) => void>()
    #cachedView?: UiSettingsView
    #cachedClientSnapshot?: {revision: string; application: {revision: string}}

    constructor(store: SettingKeyStore) {
        this.store = store
    }

    get client() {
        return {
            getSnapshot: (_scope?: string) => this.#clientSnapshot(),
            subscribe: (
                _selector: (state: any) => string,
                listener: (revision: string) => void,
            ) => {
                this.#revisionListeners.add(listener)
                listener(this.#modelsRevision)
                return () => this.#revisionListeners.delete(listener)
            },
        }
    }

    async start(_hasProject?: boolean): Promise<UiSettingsView> {
        await this.store.bootstrap()
        return this.getView()
    }

    getView(): UiSettingsView {
        const view = this.store.getView()
        const cached = this.#cachedView
        if (
            cached
            && cached.settings === view.settings
            && cached.diagnostics === view.diagnostics
            && cached.applicationRevision === this.#modelsRevision
        ) {
            return cached
        }
        const next: UiSettingsView = {
            settings: view.settings,
            diagnostics: view.diagnostics,
            applicationRevision: this.#modelsRevision,
        }
        this.#cachedView = next
        return next
    }

    #clientSnapshot(): {revision: string; application: {revision: string}} {
        const cached = this.#cachedClientSnapshot
        if (cached && cached.revision === this.#modelsRevision) return cached
        const next = {
            revision: this.#modelsRevision,
            application: {revision: this.#modelsRevision},
        }
        this.#cachedClientSnapshot = next
        return next
    }

    readonly subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener)

    readonly getSnapshot = (): UiSettingsView | undefined => this.getView()

    setModelsRevision(revision: string): void {
        if (this.#modelsRevision === revision) return
        this.#modelsRevision = revision
        for (const listener of this.#revisionListeners) listener(revision)
    }

    async notifyInvalidation(change: AgentSettingsInvalidation): Promise<void> {
        await this.store.handleInvalidation(change)
    }

    async alignApplicationRevision(revision: string): Promise<boolean> {
        if (revision) this.setModelsRevision(revision)
        return this.#modelsRevision === revision || revision === ""
    }

    stage(_operations: readonly SettingMutation[]): void {}

    mutate(operations: readonly SettingMutation[]): Promise<void> {
        return this.persist(operations)
    }

    persist(operations: readonly SettingMutation[]): Promise<void> {
        return this.store.persist(operations)
    }
}

const subscribeUnavailable = () => () => undefined
const snapshotUnavailable = () => undefined

export function useUiSettingsView(
    runtime: UiSettingsRuntime | null,
): UiSettingsView | undefined {
    return useSyncExternalStore(
        runtime?.subscribe ?? subscribeUnavailable,
        runtime?.getSnapshot ?? snapshotUnavailable,
        runtime?.getSnapshot ?? snapshotUnavailable,
    )
}
