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
        // Optimistic UI immediately; host save is debounced (or flushed now).
        runtime.stage(mutations)
        this.#pending = mergeSettingMutations(this.#pending, mutations)
        // immediate still goes through flush() so ordering vs an in-flight save is preserved.
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

    /**
     * Coalesce pending mutations into one host save.
     * Reuses the in-flight promise when already flushing, then re-checks `#pending`
     * so mutations enqueued during the save are not dropped (tail recursion).
     */
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
