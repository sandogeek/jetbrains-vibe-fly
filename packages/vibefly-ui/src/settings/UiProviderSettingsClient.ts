import type {
    CustomProviderMutationRequest,
    ProviderLoginResult,
    ProviderLogoutResult,
    ProvidersPatchResult,
    ProvidersRefreshResult,
    Ui2HostSettings,
} from "../generated/rpc"
import type {BundledCatalog} from "./catalog"
import {mergeProvidersSnapshot, type ProvidersSnapshot} from "./providerSnapshots"
import {PROVIDER_CONFIG_RPC_OPTIONS, PROVIDER_LOGIN_RPC_OPTIONS} from "./rpcOptions"
import type {UiSettingsRuntime} from "./UiSettingsRuntime"

export type GatedProviderResult<T> = T & {
    currentRevision: boolean
    safeSnapshot: ProvidersSnapshot | null
}

/**
 * Host provider config client with revision-gated snapshot delivery.
 *
 * Provider RPCs return a settings `revision` + optional snapshot. Before publishing
 * to listeners we align the local SettingsSyncClient to that revision so the UI
 * never shows provider data against a stale application document.
 *
 * 带 revision 门控快照投递的 Host Provider 配置客户端。
 *
 * Provider RPC 返回设置 `revision` + 可选 snapshot。发布给监听者之前，
 * 先将本地 SettingsSyncClient 对齐到该 revision，避免 UI 在过期的
 * application 文档上展示 Provider 数据。
 */
export class UiProviderSettingsClient {
    readonly #listeners = new Set<(snapshot: ProvidersSnapshot | null) => void>()
    /**
     * Baseline used to ignore the subscribe callback's initial/same-revision fire.
     * 基线 revision，用于忽略 subscribe 回调的初次/同 revision 触发。
     */
    #lastApplicationRevision?: string
    #refreshing?: Promise<void>
    /**
     * Nested count of in-flight `#gate` calls (read-side lock over invalidations).
     * 进行中的 `#gate` 嵌套计数（读侧对失效的锁）。
     */
    #aligning = 0
    /**
     * Set when an application revision change arrives while `#aligning > 0`.
     * 在 `#aligning > 0` 期间若收到 application revision 变更则置位。
     */
    #invalidationDuringAlign = false

    constructor(
        private readonly host: Ui2HostSettings,
        private readonly settings: UiSettingsRuntime,
        private readonly catalog: BundledCatalog,
    ) {}

    /**
     * Own application invalidation → Provider refresh and merged snapshot publication.
     * 订阅 application 失效 → 刷新 Provider 并发布合并后的 snapshot。
     */
    watch(listener: (snapshot: ProvidersSnapshot | null) => void): () => void {
        this.#listeners.add(listener)
        // Snapshot the revision we already know; only later *changes* schedule refresh.
        // 记录当前已知 revision；仅后续 *变化* 才调度 refresh。
        this.#lastApplicationRevision = this.settings.client.getSnapshot("application").revision
        const unsubscribe = this.settings.client.subscribe(
            (state) => state.application.revision,
            (revision) => {
                if (revision === this.#lastApplicationRevision) return
                this.#lastApplicationRevision = revision
                // Defer refresh until the active gate finishes — it may already carry
                // a converged snapshot, making an immediate refresh redundant or racy.
                // 推迟到当前 gate 结束后再 refresh——gate 可能已带收敛 snapshot，
                // 立即 refresh 会多余或产生竞态。
                if (this.#aligning > 0) {
                    this.#invalidationDuringAlign = true
                    return
                }
                this.#scheduleRefresh()
            },
        )
        return () => {
            unsubscribe()
            this.#listeners.delete(listener)
        }
    }

    async refresh(): Promise<GatedProviderResult<ProvidersRefreshResult>> {
        const result = await this.host.refreshProviders(PROVIDER_CONFIG_RPC_OPTIONS)
        return this.#gate(result)
    }

    /**
     * Set or replace a provider API key through the Host credential command.
     * The Agent credential store retries conflicts; the UI does not replay.
     */
    async setApiKey(providerId: string, apiKey: string): Promise<GatedProviderResult<ProvidersPatchResult>> {
        return this.#gate(await this.host.setProviderApiKey({providerId, apiKey}, PROVIDER_CONFIG_RPC_OPTIONS))
    }

    /**
     * Create or replace a custom provider entry and optionally set its API key.
     */
    async saveCustomProvider(input: {
        id: string
        configJson: string
        apiKey?: string
    }): Promise<GatedProviderResult<ProvidersPatchResult>> {
        const apiKey = input.apiKey?.trim() ?? ""
        return this.#mutateCustom({
            id: input.id,
            configJson: input.configJson,
            apiKey: apiKey || null,
            remove: false,
        })
    }

    /** Delete a custom provider entry and any stored credential for that id. */
    async deleteCustomProvider(id: string): Promise<GatedProviderResult<ProvidersPatchResult>> {
        return this.#mutateCustom({id, remove: true})
    }

    /**
     * Optimistic-concurrency custom-provider mutation with revision replay.
     * On conflict, advance `expectedRevision` from the host response when align
     * succeeded, otherwise re-read the local application revision and retry.
     * Exhausted retries surface conflict without a snapshot (caller must refresh).
     * 带 revision 重放的乐观并发自定义 Provider 变更。
     */
    async #mutateCustom(
        request: CustomProviderMutationRequest,
    ): Promise<GatedProviderResult<ProvidersPatchResult>> {
        let expectedRevision = this.settings.client.getSnapshot("application").revision
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const result = await this.host.mutateCustomProvider(
                request,
                expectedRevision,
                PROVIDER_CONFIG_RPC_OPTIONS,
            )
            const gated = await this.#gate(result)
            if (result.ok || !result.conflict || !result.revision) return gated
            expectedRevision = gated.currentRevision
                ? result.revision
                : this.settings.client.getSnapshot("application").revision
        }
        return {
            ok: false,
            conflict: true,
            error: "Settings changed externally",
            currentRevision: true,
            safeSnapshot: null,
        }
    }

    async login(providerId: string): Promise<GatedProviderResult<ProviderLoginResult>> {
        return this.#gate(await this.host.loginProvider({providerId}, PROVIDER_LOGIN_RPC_OPTIONS))
    }

    async logout(providerId: string): Promise<GatedProviderResult<ProviderLogoutResult>> {
        return this.#gate(await this.host.logoutProvider({providerId}, PROVIDER_CONFIG_RPC_OPTIONS))
    }

    cancelLogin(): Promise<void> {
        return this.host.cancelProviderLogin(PROVIDER_CONFIG_RPC_OPTIONS)
    }

    /**
     * Align local settings to `result.revision`, then publish a catalog-merged
     * snapshot only when alignment succeeded. Nested calls share one invalidation
     * flag: deferred refresh runs after the outermost gate if no snapshot was
     * accepted and the result is not a conflict (conflicts are replayed by applyPatch).
     * 将本地设置对齐到 `result.revision`，仅在对齐成功时发布与 catalog 合并的 snapshot。
     * 嵌套调用共享一个失效标志：最外层 gate 结束后，若未接受 snapshot 且结果非冲突，
     * 则执行延迟 refresh（冲突由自定义 Provider mutation 重放）。
     */
    async #gate<T extends {
        revision?: string | null
        snapshot?: import("../generated/rpc").ProvidersSnapshot | null
    }>(result: T): Promise<GatedProviderResult<T>> {
        this.#aligning += 1
        let currentRevision = true
        let safeSnapshot: ProvidersSnapshot | null = null
        let snapshotAccepted = false
        try {
            currentRevision = result.revision
                ? await this.settings.alignApplicationRevision(result.revision)
                : true
            if (result.revision) this.settings.setModelsRevision(result.revision)
            safeSnapshot = currentRevision && result.snapshot
                ? mergeProvidersSnapshot(result.snapshot, this.catalog)
                : null
            snapshotAccepted = currentRevision && result.snapshot !== undefined
            if (snapshotAccepted) {
                for (const listener of this.#listeners) listener(safeSnapshot)
            }
        } finally {
            this.#aligning -= 1
            if (this.#aligning === 0 && this.#invalidationDuringAlign) {
                this.#invalidationDuringAlign = false
                // A returned snapshot already represents the converged revision.
                // Conflicting custom-provider mutations are immediately replayed.
                // 返回的 snapshot 已代表收敛后的 revision。
                // 冲突的自定义 Provider 响应由 #mutateCustom 立即重放。
                if (!snapshotAccepted && !("conflict" in result && result.conflict)) {
                    this.#scheduleRefresh()
                }
            }
        }
        return {...result, currentRevision, safeSnapshot}
    }

    /**
     * Single-flight: concurrent invalidations collapse into one in-flight refresh.
     * 单飞：并发失效合并为一次进行中的 refresh。
     */
    #scheduleRefresh(): void {
        if (this.#refreshing) return
        this.#refreshing = this.refresh().then(() => undefined).catch(() => undefined).finally(() => {
            this.#refreshing = undefined
        })
    }
}
