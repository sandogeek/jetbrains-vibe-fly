import {afterEach, describe, test} from "node:test"
import {expect} from "expect"
import {InMemoryCredentialStore} from "@earendil-works/pi-ai"
import {clearPiRuntimeCache, getPiRuntime} from "./piRuntime.js"
import {applyProviderConfigDocumentsPatch, getProvidersSnapshot, mutateCustomProviderDocumentsPatch} from "./providerConfig.js"

afterEach(() => clearPiRuntimeCache())

describe("document-based provider snapshots", () => {
    test("preserves unknown fields and models.json apiKey without leaking auth secrets", () => {
        const modelsJson = JSON.stringify({
            providers: {
                "local-proxy": {
                    baseUrl: "https://proxy.example/v1?token=secret",
                    api: "openai-responses",
                    apiKey: "provider-level-key",
                    custom: "keep",
                    models: [{id: "demo", name: "Demo"}],
                },
            },
        })
        const authJson = JSON.stringify({
            "local-proxy": {type: "api_key", key: "super-secret"},
        })

        const snapshot = getProvidersSnapshot(modelsJson, authJson)
        const provider = (snapshot.providers ?? []).find((entry) => entry.id === "local-proxy")
        expect(provider?.configJson).toBeTruthy()
        const config = JSON.parse(provider!.configJson!) as {
            baseUrl?: string
            api?: string
            apiKey?: string
            custom?: string
            models?: Array<{id: string}>
        }
        expect(config.baseUrl).toBe("https://proxy.example/v1?token=secret")
        expect(config.api).toBe("openai-responses")
        expect(config.apiKey).toBe("provider-level-key")
        expect(config.custom).toBe("keep")
        expect(config.models?.[0]?.id).toBe("demo")
        expect(provider?.credential?.hasApiKey).toBe(true)
        expect(JSON.stringify(snapshot).includes("super-secret")).toBe(false)
    })

    test("applies a real document patch and keeps credential-only models bytes unchanged", () => {
        const modelsJson = `{"future":true}`
        const patched = mutateCustomProviderDocumentsPatch(
            {
                id: "local-proxy",
                configJson: JSON.stringify({
                        baseUrl: "https://proxy.example/v1",
                        api: "openai-completions",
                        custom: "keep",
                        models: [{id: "demo"}],
                }),
                apiKey: "new-secret",
            },
            modelsJson,
            "{}",
        )
        expect(patched.ok).toBe(true)
        expect(patched.modelsChanged).toBe(true)
        expect(patched.authChanged).toBe(true)
        const models = JSON.parse(patched.modelsJson ?? "{}") as {
            providers: {["local-proxy"]: {custom: string; models: Array<{contextWindow: number}>}}
        }
        expect(models.providers["local-proxy"].custom).toBe("keep")
        expect(models.providers["local-proxy"].models[0]?.contextWindow).toBe(128_000)

        const configOnly = applyProviderConfigDocumentsPatch(
            {
                providers: [{
                    id: "local-proxy",
                    configJson: JSON.stringify({
                        baseUrl: "https://proxy.example/v1",
                        api: "openai-completions",
                        models: [{id: "demo"}],
                    }),
                }],
            },
            modelsJson,
        )
        expect(configOnly.ok).toBe(true)
        expect(configOnly.modelsChanged).toBe(true)
        expect("authChanged" in configOnly).toBe(false)
    })

    test("returns a validation error instead of throwing", () => {
        const result = applyProviderConfigDocumentsPatch(
            {providers: [{id: "x", configJson: "[1]"}]},
            JSON.stringify({providers: {}}),
        )
        expect(result.ok).toBe(false)
        expect(result.error).toMatch(/configJson must be a JSON object/)
    })
})

describe("pi runtime cache", () => {
    test("reuses the force-created Host-backed runtime for callers without options", async () => {
        const previousAgentDir = process.env.PI_CODING_AGENT_DIR
        process.env.PI_CODING_AGENT_DIR = "/tmp/vibefly-runtime-cache"

        try {
            const credentials = new InMemoryCredentialStore()
            const runtime = await getPiRuntime({credentials, forceNew: true})
            const reused = await getPiRuntime()

            expect(reused).toBe(runtime)
            expect(reused.auth).toBe(credentials)
        } finally {
            if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
            else process.env.PI_CODING_AGENT_DIR = previousAgentDir
        }
    })
})
