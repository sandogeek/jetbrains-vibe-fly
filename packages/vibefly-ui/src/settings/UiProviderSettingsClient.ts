import type {
    CredentialAction,
    ProviderLoginResult,
    ProviderLogoutResult,
    ProviderPatch,
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
 */
export class UiProviderSettingsClient {
    readonly #listeners = new Set<(snapshot: ProvidersSnapshot | null) => void>()
    /** Baseline used to ignore the subscribe callback's initial/same-revision fire. */
    #lastApplicationRevision?: string
    #refreshing?: Promise<void>
    /** Nested count of in-flight `#gate` calls (read-side lock over invalidations). */
    #aligning = 0
    /** Set when an application revision change arrives while `#aligning > 0`. */
    #invalidationDuringAlign = false

    constructor(
        private readonly host: Ui2HostSettings,
        private readonly settings: UiSettingsRuntime,
        private readonly catalog: BundledCatalog,
    ) {}

    /** Own application invalidation → Provider refresh and merged snapshot publication. */
    watch(listener: (snapshot: ProvidersSnapshot | null) => void): () => void {
        this.#listeners.add(listener)
        // Snapshot the revision we already know; only later *changes* schedule refresh.
        this.#lastApplicationRevision = this.settings.client.getSnapshot("application").revision
        const unsubscribe = this.settings.client.subscribe(
            (state) => state.application.revision,
            (revision) => {
                if (revision === this.#lastApplicationRevision) return
                this.#lastApplicationRevision = revision
                // Defer refresh until the active gate finishes — it may already carry
                // a converged snapshot, making an immediate refresh redundant or racy.
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
     * Optimistic-concurrency patch with revision replay.
     * On conflict, advance `expectedRevision` from the host response when align
     * succeeded, otherwise re-read the local application revision and retry.
     * Exhausted retries surface conflict without a snapshot (caller must refresh).
     */
    async applyPatch(
        providers: ProviderPatch[],
        credentials: CredentialAction[] = [],
    ): Promise<GatedProviderResult<ProvidersPatchResult>> {
        let expectedRevision = this.settings.client.getSnapshot("application").revision
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const result = await this.host.applyProvidersPatch(
                {providers, credentials},
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
                // Conflicting patch responses are immediately replayed by applyPatch.
                if (!snapshotAccepted && !("conflict" in result && result.conflict)) {
                    this.#scheduleRefresh()
                }
            }
        }
        return {...result, currentRevision, safeSnapshot}
    }

    /** Single-flight: concurrent invalidations collapse into one in-flight refresh. */
    #scheduleRefresh(): void {
        if (this.#refreshing) return
        this.#refreshing = this.refresh().then(() => undefined).catch(() => undefined).finally(() => {
            this.#refreshing = undefined
        })
    }
}
