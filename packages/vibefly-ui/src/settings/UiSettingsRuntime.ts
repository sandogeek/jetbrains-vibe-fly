import {type AgentSettingsInvalidation, type SettingMutation} from "@vibefly/uiagent-shared"
import {SettingKeyStore, type SettingPersistOptions} from "./settingKeyStore"

/**
 * Agent-backed settings runtime. Confirmed values come from SettingKeyStore.
 */
export class UiSettingsRuntime {
    readonly store: SettingKeyStore
    #modelsRevision = ""
    readonly #revisionListeners = new Set<(revision: string) => void>()
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

    /**
     * Repeatable bootstrap. Agent may still be unavailable; a later call after
     * onReady is required to load confirmed values.
     * 可重复调用。Agent 当时可能尚未就绪；onReady 之后必须再调一次才能读到 confirmed 值。
     */
    async start(_hasProject?: boolean): Promise<void> {
        await this.store.bootstrap()
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

    stage(operations: readonly SettingMutation[]): void {
        this.store.stage(operations)
    }

    mutate(operations: readonly SettingMutation[]): Promise<void> {
        return this.persist(operations)
    }

    persist(
        operations: readonly SettingMutation[],
        options?: SettingPersistOptions,
    ): Promise<void> {
        return this.store.persist(operations, options)
    }
}
