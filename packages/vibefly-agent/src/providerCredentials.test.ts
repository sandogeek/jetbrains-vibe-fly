import {afterEach, describe, test} from "node:test"
import {expect} from "expect"
import {InMemoryCredentialStore} from "@earendil-works/pi-ai"
import {OAUTH_API_KEY_CONFLICT_ERROR} from "@vibefly/uiagent-shared/agent"
import {setProviderApiKey} from "./providerCredentials.js"
import {clearPiRuntimeCache, getPiRuntime} from "./piRuntime.js"

afterEach(() => clearPiRuntimeCache())

describe("setProviderApiKey", () => {
    test("writes an API key through the runtime credential store", async () => {
        const credentials = new InMemoryCredentialStore()
        const runtime = await getPiRuntime({credentials, forceNew: true})

        const result = await setProviderApiKey(
            {providerId: "custom", apiKey: "sk-new"},
            runtime,
        )

        expect(result).toEqual({ok: true})
        expect(await credentials.read("custom")).toEqual({
            type: "api_key",
            key: "sk-new",
        })
    })

    test("preserves unknown api_key fields and refuses to overwrite OAuth", async () => {
        const credentials = new InMemoryCredentialStore()
        await credentials.modify("custom", async () => ({
            type: "api_key",
            key: "old",
            future: {keep: true},
        } as never))
        await credentials.modify("oauth-provider", async () => ({
            type: "oauth",
            access: "token",
        } as never))
        const runtime = await getPiRuntime({credentials, forceNew: true})

        const updated = await setProviderApiKey(
            {providerId: "custom", apiKey: "sk-new"},
            runtime,
        )
        const rejected = await setProviderApiKey(
            {providerId: "oauth-provider", apiKey: "sk-new"},
            runtime,
        )

        expect(updated).toEqual({ok: true})
        expect(await credentials.read("custom")).toEqual({
            type: "api_key",
            key: "sk-new",
            future: {keep: true},
        })
        expect(rejected).toEqual({
            ok: false,
            error: OAUTH_API_KEY_CONFLICT_ERROR,
        })
        expect(await credentials.read("oauth-provider")).toEqual({
            type: "oauth",
            access: "token",
        })
    })
})
