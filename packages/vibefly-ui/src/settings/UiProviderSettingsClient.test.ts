import {describe, test} from "node:test"
import {expect} from "expect"
import type {
    ProvidersPatchRequest,
    ProvidersPatchResult,
    ProvidersRefreshResult,
    SettingsSaveRequest,
    Ui2Host,
    Ui2HostSettings,
    UiSettingsSnapshot,
} from "../generated/rpc"
import {emptyCatalog} from "./catalog"
import {UiProviderSettingsClient} from "./UiProviderSettingsClient"
import {UiSettingsRuntime} from "./UiSettingsRuntime"

function application(revision: string): UiSettingsSnapshot {
    return {
        scope: "application",
        projectRoot: null,
        settingsJson: "{}",
        vibeflyJson: "{}",
        revision,
        diagnostics: [],
    }
}

class FakeSettingsHost {
    application = application("app-1")

    async getSettingsSnapshot(): Promise<UiSettingsSnapshot> {
        return structuredClone(this.application)
    }

    async saveSettings(_request: SettingsSaveRequest) {
        throw new Error("not used")
    }

    asHost(): Ui2Host {
        return this as unknown as Ui2Host
    }
}

class FakeProviderHost {
    refreshResult: ProvidersRefreshResult = {ok: true}
    refreshCalls = 0
    readonly patchRequests: Array<{request: ProvidersPatchRequest; revision: string}> = []
    patchImpl: (revision: string) => Promise<ProvidersPatchResult> = async () => ({ok: true})

    async refreshProviders(): Promise<ProvidersRefreshResult> {
        this.refreshCalls += 1
        return structuredClone(this.refreshResult)
    }

    async applyProvidersPatch(
        request: ProvidersPatchRequest,
        expectedRevision: string,
    ): Promise<ProvidersPatchResult> {
        this.patchRequests.push({request: structuredClone(request), revision: expectedRevision})
        return this.patchImpl(expectedRevision)
    }

    asHost(): Ui2HostSettings {
        return this as unknown as Ui2HostSettings
    }
}

describe("UiProviderSettingsClient", () => {
    test("accepts a Provider snapshot only after settings reaches its revision", async () => {
        const settingsHost = new FakeSettingsHost()
        const settings = new UiSettingsRuntime(settingsHost.asHost())
        await settings.start(false)
        const providerHost = new FakeProviderHost()
        const client = new UiProviderSettingsClient(providerHost.asHost(), settings, emptyCatalog)

        settingsHost.application = application("app-2")
        providerHost.refreshResult = {
            ok: true,
            revision: "app-2",
            snapshot: {providers: [{id: "custom"}]},
        }
        const current = await client.refresh()
        expect(current.currentRevision).toBe(true)
        expect(current.safeSnapshot?.providers.map((provider) => provider.id)).toEqual(["custom"])

        providerHost.refreshResult = {
            ok: true,
            revision: "missing-revision",
            snapshot: {providers: [{id: "stale"}]},
        }
        const stale = await client.refresh()
        expect(stale.currentRevision).toBe(false)
        expect(stale.safeSnapshot).toBeNull()
    })

    test("owns application invalidation refresh and publishes the merged snapshot", async () => {
        const settingsHost = new FakeSettingsHost()
        const settings = new UiSettingsRuntime(settingsHost.asHost())
        await settings.start(false)
        const providerHost = new FakeProviderHost()
        providerHost.refreshResult = {
            ok: true,
            revision: "app-2",
            snapshot: {providers: [{id: "from-invalidation"}]},
        }
        const client = new UiProviderSettingsClient(providerHost.asHost(), settings, emptyCatalog)
        const published: Array<string | null> = []
        const stop = client.watch((snapshot) => {
            published.push(snapshot?.providers[0]?.id ?? null)
        })

        settingsHost.application = application("app-2")
        await settings.notify("application", null, "app-2")
        for (let attempt = 0; attempt < 20 && published.length === 0; attempt += 1) {
            await new Promise<void>((resolve) => setImmediate(resolve))
        }
        stop()

        expect(providerHost.refreshCalls).toBe(1)
        expect(published).toEqual(["from-invalidation"])
    })

    test("replays a conflicting Provider patch against the converged revision", async () => {
        const settingsHost = new FakeSettingsHost()
        const settings = new UiSettingsRuntime(settingsHost.asHost())
        await settings.start(false)
        const providerHost = new FakeProviderHost()
        let attempts = 0
        providerHost.patchImpl = async () => {
            attempts += 1
            if (attempts === 1) {
                settingsHost.application = application("app-2")
                return {ok: false, conflict: true, revision: "app-2"}
            }
            settingsHost.application = application("app-3")
            return {
                ok: true,
                revision: "app-3",
                snapshot: {providers: [{id: "custom"}]},
            }
        }
        const client = new UiProviderSettingsClient(providerHost.asHost(), settings, emptyCatalog)

        const result = await client.applyPatch([{id: "custom", configJson: "{}"}])

        expect(result.ok).toBe(true)
        expect(result.safeSnapshot?.providers).toHaveLength(1)
        expect(providerHost.patchRequests.map((request) => request.revision)).toEqual([
            "app-1",
            "app-2",
        ])
    })

    test("replays against a newer authoritative revision than the conflict response", async () => {
        const settingsHost = new FakeSettingsHost()
        const settings = new UiSettingsRuntime(settingsHost.asHost())
        await settings.start(false)
        const providerHost = new FakeProviderHost()
        let attempts = 0
        providerHost.patchImpl = async () => {
            attempts += 1
            if (attempts === 1) {
                settingsHost.application = application("app-3")
                return {ok: false, conflict: true, revision: "app-2"}
            }
            return {ok: true, revision: "app-3", snapshot: {providers: []}}
        }
        const client = new UiProviderSettingsClient(providerHost.asHost(), settings, emptyCatalog)

        const result = await client.applyPatch([{id: "custom", remove: true}])

        expect(result.ok).toBe(true)
        expect(providerHost.patchRequests.map((request) => request.revision)).toEqual([
            "app-1",
            "app-3",
        ])
    })
})
