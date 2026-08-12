import {mergeSettingMutations, type SettingMutation} from "@vibefly/uiagent-shared"
import type {UiSettingsRuntime} from "./UiSettingsRuntime"

export type SettingsMutateOptions = {
    immediate?: boolean
}

const DEFAULT_DEBOUNCE_MS = 300

/**
 * Single settings mutation scheduler for the settings shell.
 * Stages immediately for optimistic UI, debounces host saves, and flushes on close.
 */
export class SettingsMutationQueue {
    readonly #runtime: () => UiSettingsRuntime | null
    readonly #onError: (error: unknown) => void
    readonly #debounceMs: number
    #pending: SettingMutation[] = []
    #timer: ReturnType<typeof setTimeout> | undefined
    #flushing: Promise<void> | null = null
    #closed = false

    constructor(
        runtime: () => UiSettingsRuntime | null,
        onError: (error: unknown) => void,
        debounceMs = DEFAULT_DEBOUNCE_MS,
    ) {
        this.#runtime = runtime
        this.#onError = onError
        this.#debounceMs = debounceMs
    }

    enqueue(mutations: readonly SettingMutation[], options?: SettingsMutateOptions): void {
        if (this.#closed || mutations.length === 0) return
        const runtime = this.#runtime()
        if (!runtime) return
        runtime.stage(mutations)
        this.#pending = mergeSettingMutations(this.#pending, mutations)
        if (options?.immediate) {
            void this.flush()
            return
        }
        if (this.#timer) clearTimeout(this.#timer)
        this.#timer = setTimeout(() => {
            this.#timer = undefined
            void this.flush()
        }, this.#debounceMs)
    }

    flush(): Promise<void> {
        if (this.#timer) {
            clearTimeout(this.#timer)
            this.#timer = undefined
        }
        if (this.#flushing) {
            return this.#flushing.then(() => {
                if (this.#pending.length === 0) return
                return this.flush()
            })
        }
        const batch = this.#pending
        this.#pending = []
        if (batch.length === 0) return Promise.resolve()
        const runtime = this.#runtime()
        if (!runtime) return Promise.resolve()
        this.#flushing = runtime.mutate(batch).catch((error) => {
            this.#onError(error)
        }).finally(() => {
            this.#flushing = null
        })
        return this.#flushing.then(() => {
            if (this.#pending.length === 0) return
            return this.flush()
        })
    }

    close(): Promise<void> {
        this.#closed = true
        return this.flush()
    }
}
