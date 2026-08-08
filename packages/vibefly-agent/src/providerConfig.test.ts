import {afterEach, describe, test} from "node:test"
import {expect} from "expect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {InMemoryCredentialStore} from "@earendil-works/pi-ai"
import {clearPiRuntimeCache, getPiRuntime} from "./piRuntime.js"
import {getProvidersSnapshot, rejectAgentProviderPatch} from "./providerConfig.js"

afterEach(() => clearPiRuntimeCache())

describe("Host-backed provider snapshots", () => {
    test("reports full configJson and credential state", async () => {
        const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibefly-provider-"))
        const credentials = new InMemoryCredentialStore()
        const runtime = await getPiRuntime({agentDir, credentials, forceNew: true})
        runtime.modelRuntime.registerProvider("local-proxy", {
            baseUrl: "https://proxy.example/v1",
            api: "openai-responses",
            models: [{
                id: "demo",
                name: "Demo",
                reasoning: false,
                input: ["text"],
                cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
                contextWindow: 128_000,
                maxTokens: 16_384,
            }],
        })
        await credentials.modify("local-proxy", async () => ({
            type: "api_key",
            key: "secret",
        }))
        await runtime.modelRuntime.refresh({allowNetwork: false})

        const snapshot = await getProvidersSnapshot(runtime)
        const provider = snapshot.providers?.find((entry) => entry.id === "local-proxy")
        expect(provider?.configJson).toBeTruthy()
        const config = JSON.parse(provider!.configJson!) as {
            baseUrl?: string
            api?: string
            models?: Array<{ id: string }>
        }
        expect(config.baseUrl).toBe("https://proxy.example/v1")
        expect(config.api).toBe("openai-responses")
        expect(config.models?.[0]?.id).toBe("demo")
        expect(provider?.credential?.hasApiKey).toBe(true)
        expect(fs.readdirSync(agentDir)).toEqual([])
    })

    test("rejects legacy Agent-side model persistence", () => {
        expect(rejectAgentProviderPatch()).toEqual({
            ok: false,
            error: "Provider configuration is owned by the Host settings service",
        })
    })
})

describe("pi runtime cache", () => {
    test("reuses the force-created Host-backed runtime for callers without options", async () => {
        const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibefly-runtime-"))
        const credentials = new InMemoryCredentialStore()
        const previousAgentDir = process.env.PI_CODING_AGENT_DIR
        process.env.PI_CODING_AGENT_DIR = agentDir

        try {
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
