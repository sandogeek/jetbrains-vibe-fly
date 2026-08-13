import {mergeSettingMutations, type SettingMutation} from "@vibefly/uiagent-shared"
import type {UiSettingsRuntime} from "./UiSettingsRuntime"

export type SettingsMutateOptions = {
    immediate?: boolean
}

const DEFAULT_DEBOUNCE_MS = 300

/**
 * Single settings mutation scheduler for the settings shell.
 * Queue owns debounce, merge, in-flight ordering, and close flush.
 * Runtime.stage() is optimistic UI; Runtime.persist() is the host write.
 * 设置壳的唯一设置变更调度器。
 * Queue 负责防抖、合并、飞行中写入排序和 close 冲刷。
 * Runtime.stage() 做乐观 UI；Runtime.persist() 写 Host。
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
        // Optimistic UI immediately; persist() is debounced (or flushed now).
        // 立即乐观更新 UI；persist() 走防抖（或立即 flush）。
        runtime.stage(mutations)
        this.#pending = mergeSettingMutations(this.#pending, mutations)
        // immediate still goes through flush() so ordering vs an in-flight save is preserved.
        // immediate 仍走 flush()，以保持与进行中保存的顺序。
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
     * Coalesce pending mutations into one Runtime.persist() (no restage).
     * Reuses the in-flight promise when already flushing, then re-checks `#pending`
     * so mutations enqueued during the save are not dropped (tail recursion).
     * 将待处理变更合并为一次 Runtime.persist()（不再 stage）。
     * 若已在 flush，复用进行中的 promise，再重新检查 `#pending`，
     * 避免保存期间入队的变更被丢弃（尾递归）。
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
        this.#flushing = runtime.persist(batch).catch((error) => {
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
