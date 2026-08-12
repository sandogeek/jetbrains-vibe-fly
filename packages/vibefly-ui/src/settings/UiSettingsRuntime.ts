import {
    applySettingMutations,
    computeEffectiveSettings,
    type SafeSettingsSnapshot,
    type SettingMutation,
    settingMutationId,
    SettingsSyncClient,
    type SettingsSyncState,
} from "@vibefly/uiagent-shared"
import {useSyncExternalStore} from "react"
import type {Ui2Host} from "../generated/rpc"
import {diagnosticsText, safeUiSettingsSnapshot, settingsFromState} from "./hostSettings"
import type {IdeSettings} from "./settingsStore"

export type UiSettingsView = {
    settings: IdeSettings
    diagnostics: string | null
    applicationRevision: string
}

function operationFingerprint(operation: SettingMutation): string {
    return JSON.stringify(operation.kind === "set"
        ? [operation.kind, operation.key.id, operation.value]
        : [operation.kind, operation.key.id])
}

export class UiSettingsRuntime {
    readonly client: SettingsSyncClient<SafeSettingsSnapshot>
    readonly #listeners = new Set<() => void>()
    readonly #draft = new Map<string, SettingMutation>()
    #view?: UiSettingsView

    constructor(host: Ui2Host) {
        this.client = new SettingsSyncClient({
            fetch: async (scope) => safeUiSettingsSnapshot(await host.getSettingsSnapshot(scope)),
            save: async (request) => host.saveSettings(request),
        })
        this.client.subscribe(
            (state) => state,
            (state) => this.#updateView(state),
        )
    }

    async start(hasProject: boolean): Promise<UiSettingsView> {
        await this.client.start({hasProject})
        return this.getView()
    }

    getView(): UiSettingsView {
        if (!this.#view) throw new Error("UiSettingsRuntime has not started")
        return this.#view
    }

    readonly subscribe = (listener: () => void): (() => void) => {
        this.#listeners.add(listener)
        return () => this.#listeners.delete(listener)
    }

    readonly getSnapshot = (): UiSettingsView | undefined => this.#view

    notify(scope: string, projectRoot: string | null, revision: string): Promise<void> {
        if (scope !== "application" && scope !== "project") return Promise.resolve()
        return this.client.notify({scope, projectRoot, revision})
    }

    /** Returns true when local application revision converged to `revision` (conflict probe). */
    alignApplicationRevision(revision: string): Promise<boolean> {
        return this.client.syncTo("application", revision).then(
            () => this.client.getSnapshot("application").revision === revision,
        )
    }

    /** Apply mutations to the local draft only (optimistic UI, no host write). */
    stage(operations: readonly SettingMutation[]): void {
        for (const operation of operations) {
            const id = settingMutationId(operation)
            this.#draft.set(id, operation)
        }
        if (operations.length > 0) this.#updateView(this.client.getState())
    }

    /**
     * Persist mutations to Host application scope, then clear matching draft entries.
     * Fingerprint capture at send time avoids deleting a draft entry that a later
     * edit overwrote while this save was in flight.
     */
    mutate(operations: readonly SettingMutation[]): Promise<void> {
        if (operations.length === 0) return Promise.resolve()
        const captured = new Map<string, string>()
        this.stage(operations)
        for (const operation of operations) {
            const id = settingMutationId(operation)
            captured.set(id, operationFingerprint(operation))
        }
        // Settings shell always saves application scope (project overrides are separate).
        return this.client.mutate("application", operations).then((result) => {
            if (!result.ok) throw new Error(result.error ?? "Settings save failed")
            for (const [id, fingerprint] of captured) {
                const current = this.#draft.get(id)
                if (current && operationFingerprint(current) === fingerprint) this.#draft.delete(id)
            }
            this.#updateView(this.client.getState())
        }).catch((error) => {
            for (const [id, fingerprint] of captured) {
                const current = this.#draft.get(id)
                if (current && operationFingerprint(current) === fingerprint) this.#draft.delete(id)
            }
            this.#updateView(this.client.getState())
            throw error
        })
    }

    /** Recompute view from host state + in-memory draft overlay. */
    #updateView(state: SettingsSyncState<SafeSettingsSnapshot>): void {
        const documents = applySettingMutations(state.application, [...this.#draft.values()])
        const application = {
            ...state.application,
            settingsJson: documents.settingsJson,
            vibeflyJson: documents.vibeflyJson,
        }
        const draftState: SettingsSyncState<SafeSettingsSnapshot> = {
            ...state,
            application,
            effective: computeEffectiveSettings(application, state.project),
        }
        this.#view = {
            settings: settingsFromState(draftState),
            diagnostics: diagnosticsText(state),
            applicationRevision: state.application.revision,
        }
        for (const listener of this.#listeners) listener()
    }
}

const subscribeUnavailable = () => () => undefined
const snapshotUnavailable = () => undefined

/** React projection over the same runtime used by imperative Host notifications. */
export function useUiSettingsView(
    runtime: UiSettingsRuntime | null,
): UiSettingsView | undefined {
    return useSyncExternalStore(
        runtime?.subscribe ?? subscribeUnavailable,
        runtime?.getSnapshot ?? snapshotUnavailable,
        runtime?.getSnapshot ?? snapshotUnavailable,
    )
}
