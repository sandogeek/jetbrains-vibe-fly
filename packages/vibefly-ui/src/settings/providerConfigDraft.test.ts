import {describe, test} from "node:test"
import {expect} from "expect"
import {draftFromConfigJson, draftToConfigJson, modelsFromConfigJson, validateConfigJson,} from "./providerConfigDraft"

describe("providerConfigDraft", () => {
    test("Basic ↔ JSON round-trip preserves known and unknown fields", () => {
        const source = {
            baseUrl: "https://example.test/v1?token=keep",
            api: "openai-completions",
            apiKey: "provider-key",
            headers: {"X-Custom": "1"},
            customTop: {nested: true},
            models: [
                {
                    id: "one",
                    name: "One",
                    reasoning: true,
                    input: ["text", "image"],
                    contextWindow: 1000,
                    maxTokens: 200,
                    cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0, tiers: [{upto: 1}]},
                    compat: {future: true},
                    thinkingLevelMap: {low: "x"},
                    mystery: 42,
                },
            ],
        }
        const draft = draftFromConfigJson(JSON.stringify(source))
        expect(draft.baseUrl).toBe(source.baseUrl)
        expect(draft.extra.apiKey).toBe("provider-key")
        expect(draft.extra.customTop).toEqual({nested: true})
        expect(draft.models[0]?.extra.mystery).toBe(42)
        expect(draft.models[0]?.thinkingLevelMap).toEqual({low: "x"})
        expect(draft.models[0]?.cost.tiers).toEqual([{upto: 1}])

        const roundTrip = JSON.parse(draftToConfigJson(draft)) as typeof source
        expect(roundTrip.baseUrl).toBe(source.baseUrl)
        expect(roundTrip.apiKey).toBe("provider-key")
        expect(roundTrip.customTop).toEqual({nested: true})
        expect(roundTrip.headers).toEqual({"X-Custom": "1"})
        expect(roundTrip.models[0]?.compat).toEqual({future: true})
        expect(roundTrip.models[0]?.thinkingLevelMap).toEqual({low: "x"})
        expect(roundTrip.models[0]?.mystery).toBe(42)
        expect(roundTrip.models[0]?.cost.tiers).toEqual([{upto: 1}])
    })

    test("validateConfigJson rejects invalid shapes", () => {
        expect(validateConfigJson("[]").ok).toBe(false)
        expect(validateConfigJson('{"providers":{}}').ok).toBe(false)
        expect(validateConfigJson('{"models":[{"id":"a"},{"id":"a"}],"baseUrl":"https://a","api":"openai-completions"}').ok)
            .toBe(false)
        expect(validateConfigJson('{"models":[{"id":"a"}]}').ok).toBe(false)
        expect(validateConfigJson('{"baseUrl":"https://a","api":"openai-completions","models":[{"id":"a"}]}').ok)
            .toBe(true)
    })

    test("modelsFromConfigJson extracts picker models", () => {
        const models = modelsFromConfigJson(JSON.stringify({
            models: [{id: "demo", name: "Demo", api: "openai-responses"}],
        }))
        expect(models).toEqual([{id: "demo", name: "Demo", api: "openai-responses"}])
    })
})
