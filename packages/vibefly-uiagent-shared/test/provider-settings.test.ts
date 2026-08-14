import assert from "node:assert/strict"
import {describe, test} from "node:test"
import {
    applyProviderApiKey,
    applyProviderConfigPatch,
    mutateCustomProviderDocuments,
    OAUTH_API_KEY_CONFLICT_ERROR,
    snapshotProviders,
} from "../src/provider-settings.js"

describe("provider document snapshot and patch", () => {
    test("snapshot returns full provider JSON including unknown fields apiKey headers and URL query", () => {
        const snapshot = snapshotProviders(
            JSON.stringify({
                providers: {
                    private: {
                        baseUrl: "https://user:password@example.test/v1?token=secret#private",
                        api: "openai-completions",
                        apiKey: "provider-level-key",
                        headers: {"X-Custom": "h"},
                        custom: "keep",
                        models: [{id: "one", name: "One", compat: {future: true}}],
                    },
                },
            }),
            JSON.stringify({
                private: {type: "api_key", key: "super-secret"},
            }),
        )

        const provider = snapshot.providers[0]
        assert.ok(provider)
        assert.equal(provider.credential.hasApiKey, true)
        assert.ok(provider.configJson)
        const config = JSON.parse(provider.configJson) as {
            baseUrl: string
            apiKey: string
            custom: string
            headers: {["X-Custom"]: string}
        }
        assert.equal(config.baseUrl, "https://user:password@example.test/v1?token=secret#private")
        assert.equal(config.apiKey, "provider-level-key")
        assert.equal(config.custom, "keep")
        assert.equal(config.headers["X-Custom"], "h")
        assert.equal(JSON.stringify(snapshot).includes("super-secret"), false)
        assert.equal(provider.configJson.includes("provider-level-key"), true)
    })

    test("full JSON patch replaces provider entry and preserves unknown nested fields", () => {
        const patched = mutateCustomProviderDocuments(
            JSON.stringify({
                top: "keep",
                providers: {
                    private: {
                        baseUrl: "https://old",
                        api: "openai-responses",
                        custom: "old",
                        models: [{id: "one", name: "Old"}],
                    },
                },
            }),
            JSON.stringify({
                other: {type: "oauth", access: "preserve"},
            }),
            {
                id: "private",
                configJson: JSON.stringify({
                        baseUrl: "https://new",
                        api: "openai-completions",
                        custom: "keep",
                        headers: {"X-A": "1"},
                        models: [
                            {
                                id: "one",
                                name: "New",
                                compat: {future: true},
                                maxTokens: 99,
                                thinkingLevelMap: {low: "x"},
                                cost: {
                                    input: 1,
                                    output: 2,
                                    cacheRead: 0,
                                    cacheWrite: 0,
                                    tiers: [{upto: 1}],
                                },
                            },
                            {id: "two"},
                        ],
                }),
                apiKey: "new-secret",
            },
        )

        const models = JSON.parse(patched.modelsJson) as {
            top: string
            providers: {
                private: {
                    baseUrl: string
                    custom: string
                    headers: {["X-A"]: string}
                    models: Array<{
                        id: string
                        maxTokens: number
                        contextWindow: number
                        compat?: {future: boolean}
                        thinkingLevelMap?: {low: string}
                        cost?: {tiers?: unknown[]}
                    }>
                }
            }
        }
        const auth = JSON.parse(patched.authJson) as {
            other: {type: string}
            private: {type: string; key: string}
        }
        assert.equal(models.top, "keep")
        assert.equal(models.providers.private.baseUrl, "https://new")
        assert.equal(models.providers.private.custom, "keep")
        assert.equal(models.providers.private.headers["X-A"], "1")
        assert.equal(models.providers.private.models.length, 2)
        assert.equal(models.providers.private.models[0]?.maxTokens, 99)
        assert.equal(models.providers.private.models[0]?.compat?.future, true)
        assert.equal(models.providers.private.models[0]?.thinkingLevelMap?.low, "x")
        assert.equal(models.providers.private.models[0]?.cost?.tiers?.length, 1)
        assert.equal(models.providers.private.models[1]?.id, "two")
        assert.equal(models.providers.private.models[1]?.contextWindow, 128_000)
        assert.equal(models.providers.private.models[1]?.maxTokens, 16_384)
        assert.equal(auth.other.type, "oauth")
        assert.equal(auth.private.key, "new-secret")
        assert.equal(patched.modelsChanged, true)
        assert.equal(patched.authChanged, true)
        assert.equal(patched.snapshot.providers.some((item) => item.id === "private"), true)
    })

    test("rejects non-object configJson duplicate model ids and bad field types", () => {
        const modelsJson = JSON.stringify({providers: {}})
        assert.throws(
            () => applyProviderConfigPatch(modelsJson, {
                providers: [{id: "x", configJson: "[1]"}],
            }),
            /configJson must be a JSON object/,
        )
        assert.throws(
            () => applyProviderConfigPatch(modelsJson, {
                providers: [{
                    id: "x",
                    configJson: JSON.stringify({
                        baseUrl: "https://a",
                        api: "openai-completions",
                        models: [{id: "a"}, {id: "a"}],
                    }),
                }],
            }),
            /duplicate model id/,
        )
        assert.throws(
            () => applyProviderConfigPatch(modelsJson, {
                providers: [{
                    id: "x",
                    configJson: JSON.stringify({
                        baseUrl: "https://a",
                        api: "openai-completions",
                        models: [{id: "a", contextWindow: "big"}],
                    }),
                }],
            }),
            /contextWindow must be a number/,
        )
        assert.throws(
            () => applyProviderConfigPatch(modelsJson, {
                providers: [{
                    id: "x",
                    configJson: JSON.stringify({models: [{id: "a"}]}),
                }],
            }),
            /baseUrl is required/,
        )
    })

    test("config patches never touch auth.json and empty patches keep models bytes", () => {
        const modelsJson = `{"future":true}`
        const configOnly = applyProviderConfigPatch(modelsJson, {})
        assert.equal(configOnly.modelsChanged, false)
        assert.equal(configOnly.modelsJson, modelsJson)

        const authOnly = applyProviderApiKey("{}", {providerId: "private", apiKey: "secret"})
        assert.equal(authOnly.authChanged, true)
        assert.equal("modelsJson" in authOnly, false)

        const empty = applyProviderConfigPatch(modelsJson, {providers: []})
        assert.equal(empty.modelsChanged, false)
        assert.equal(empty.modelsJson, modelsJson)
    })

    test("removing a custom provider clears the models entry and any credential", () => {
        const patched = mutateCustomProviderDocuments(
            JSON.stringify({
                providers: {
                    private: {
                        baseUrl: "https://a",
                        api: "openai-completions",
                        models: [{id: "m"}],
                    },
                },
            }),
            JSON.stringify({
                private: {type: "api_key", key: "k"},
            }),
            {
                id: "private",
                remove: true,
            },
        )
        const models = JSON.parse(patched.modelsJson) as {providers?: Record<string, unknown>}
        assert.equal(models.providers?.private, undefined)
        assert.equal("private" in (JSON.parse(patched.authJson) as object), false)
    })

    test("setting an API key preserves unknown fields on the same credential", () => {
        const patched = applyProviderApiKey(
            JSON.stringify({
                private: {
                    type: "api_key",
                    key: "old-secret",
                    future: {refreshMode: "keep"},
                    version: 7,
                },
            }),
            {providerId: "private", apiKey: "new-secret"},
        )
        const credential = (JSON.parse(patched.authJson) as {
            private: {type: string; key: string; future: {refreshMode: string}; version: number}
        }).private
        assert.equal(credential.type, "api_key")
        assert.equal(credential.key, "new-secret")
        assert.equal(credential.future.refreshMode, "keep")
        assert.equal(credential.version, 7)
        assert.equal(patched.authJson.includes("old-secret"), false)
    })

    test("setting an API key refuses to overwrite an OAuth session", () => {
        assert.throws(
            () => applyProviderApiKey(
                JSON.stringify({
                    private: {type: "oauth", access: "token"},
                    other: {type: "api_key", key: "keep"},
                }),
                {providerId: "private", apiKey: "new-secret"},
            ),
            {message: OAUTH_API_KEY_CONFLICT_ERROR},
        )
        assert.throws(
            () => mutateCustomProviderDocuments(
                JSON.stringify({providers: {private: {baseUrl: "https://a", api: "openai-completions", models: [{id: "m"}]}}}),
                JSON.stringify({private: {type: "oauth", access: "token"}}),
                {
                    id: "private",
                    configJson: JSON.stringify({
                        baseUrl: "https://a",
                        api: "openai-completions",
                        models: [{id: "m"}],
                    }),
                    apiKey: "new-secret",
                },
            ),
            {message: OAUTH_API_KEY_CONFLICT_ERROR},
        )
    })

    test("custom save without an API key leaves auth.json byte-identical", () => {
        const authJson = JSON.stringify({private: {type: "api_key", key: "keep"}})
        const patched = mutateCustomProviderDocuments(
            JSON.stringify({providers: {}}),
            authJson,
            {
                id: "private",
                configJson: JSON.stringify({
                    baseUrl: "https://a",
                    api: "openai-completions",
                    models: [{id: "m"}],
                }),
            },
        )
        assert.equal(patched.modelsChanged, true)
        assert.equal(patched.authChanged, false)
        assert.equal(patched.authJson, authJson)
        assert.equal(JSON.stringify(patched.snapshot).includes("keep"), false)
    })
})
