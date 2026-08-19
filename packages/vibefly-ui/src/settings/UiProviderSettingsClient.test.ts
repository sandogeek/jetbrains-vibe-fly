import {describe, test} from "node:test"
import {expect} from "expect"
import type {
    CustomProviderMutationRequest,
    ProvidersPatchResult,
    ProvidersRefreshResult,
    Ui2HostSettings,
} from "../generated/rpc"
import {emptyCatalog} from "./catalog"
import {UiProviderSettingsClient} from "./UiProviderSettingsClient"
import {UiSettingsRuntime} from "./UiSettingsRuntime"
import {SettingKeyStore} from "./settingKeyStore"

class FakeProviderHost {
    refreshResult: ProvidersRefreshResult = {ok: true}
    refreshCalls = 0
    readonly mutationRequests: Array<{request: CustomProviderMutationRequest; revision: string}> = []
    patchImpl: (revision: string) => Promise<ProvidersPatchResult> = async () => ({ok: true})
    readonly apiKeyRequests: Array<{providerId: string; apiKey: string}> = []

    async refreshProviders(): Promise<ProvidersRefreshResult> {
        this.refreshCalls += 1
        return structuredClone(this.refreshResult)
    }

    async mutateCustomProvider(
        request: CustomProviderMutationRequest,
        expectedRevision: string,
    ): Promise<ProvidersPatchResult> {
        this.mutationRequests.push({request: structuredClone(request), revision: expectedRevision})
        return this.patchImpl(expectedRevision)
    }

    async setProviderApiKey(request: {providerId: string; apiKey: string}): Promise<ProvidersPatchResult> {
        this.apiKeyRequests.push(structuredClone(request))
        return {ok: true, revision: "app-2", snapshot: {providers: [{id: request.providerId}]}}
    }

    asHost(): Ui2HostSettings {
        return this as unknown as Ui2HostSettings
    }
}

describe("UiProviderSettingsClient", () => {
    test("records the Provider revision and publishes the snapshot", async () => {
        const settings = new UiSettingsRuntime(new SettingKeyStore(() => null))
        await settings.start(false)
        settings.setModelsRevision("app-1")
        const providerHost = new FakeProviderHost()
        const client = new UiProviderSettingsClient(providerHost.asHost(), settings, emptyCatalog)

        providerHost.refreshResult = {
            ok: true,
            revision: "app-2",
            snapshot: {providers: [{id: "custom"}]},
        }
        const current = await client.refresh()
        expect(current.currentRevision).toBe(true)
        expect(current.safeSnapshot?.providers.map((provider) => provider.id)).toEqual(["custom"])
        expect(settings.client.getSnapshot("application").revision).toBe("app-2")
    })

    test("owns application invalidation refresh and publishes the merged snapshot", async () => {
        const settings = new UiSettingsRuntime(new SettingKeyStore(() => null))
        await settings.start(false)
        settings.setModelsRevision("app-1")
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

        settings.setModelsRevision("app-2")
        for (let attempt = 0; attempt < 20 && published.length === 0; attempt += 1) {
            await new Promise<void>((resolve) => setImmediate(resolve))
        }
        stop()

        expect(providerHost.refreshCalls).toBe(1)
        expect(published).toEqual(["from-invalidation"])
    })

    test("replays a conflicting Provider patch against the converged revision", async () => {
        const settings = new UiSettingsRuntime(new SettingKeyStore(() => null))
        await settings.start(false)
        settings.setModelsRevision("app-1")
        const providerHost = new FakeProviderHost()
        let attempts = 0
        providerHost.patchImpl = async () => {
            attempts += 1
            if (attempts === 1) {
                settings.setModelsRevision("app-2")
                return {ok: false, conflict: true, revision: "app-2"}
            }
            settings.setModelsRevision("app-3")
            return {
                ok: true,
                revision: "app-3",
                snapshot: {providers: [{id: "custom"}]},
            }
        }
        const client = new UiProviderSettingsClient(providerHost.asHost(), settings, emptyCatalog)

        const result = await client.saveCustomProvider({id: "custom", configJson: "{}"})

        expect(result.ok).toBe(true)
        expect(result.safeSnapshot?.providers).toHaveLength(1)
        expect(providerHost.mutationRequests.map((request) => request.revision)).toEqual([
            "app-1",
            "app-2",
        ])
        expect(providerHost.mutationRequests[0]?.request).toEqual({
            id: "custom",
            configJson: "{}",
            apiKey: null,
            remove: false,
        })
    })

    test("setApiKey does not replay conflicts in the UI client", async () => {
        const settings = new UiSettingsRuntime(new SettingKeyStore(() => null))
        await settings.start(false)
        settings.setModelsRevision("app-1")
        const providerHost = new FakeProviderHost()
        const client = new UiProviderSettingsClient(providerHost.asHost(), settings, emptyCatalog)

        const result = await client.setApiKey("openai", "sk-test")

        expect(result.ok).toBe(true)
        expect(providerHost.apiKeyRequests).toEqual([{providerId: "openai", apiKey: "sk-test"}])
        expect(providerHost.mutationRequests).toHaveLength(0)
    })
})
