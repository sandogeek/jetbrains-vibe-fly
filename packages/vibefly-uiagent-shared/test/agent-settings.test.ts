import {readFileSync} from "node:fs"
import assert from "node:assert/strict"
import {describe, test} from "node:test"
import {
    deleteCredential,
    getCredential,
    normalizeAgentSettingsSnapshot,
    parseAuthJson,
    parseModelsJson,
    setCredential,
    updateCredential,
} from "../src/agent-settings.js"

describe("agent-only settings documents", () => {
    test("models validation preserves top-level and provider unknown keys", () => {
        const result = parseModelsJson(JSON.stringify({
            providers: {
                custom: {
                    baseUrl: "https://example.test/v1",
                    models: [{id: "model-1"}],
                    futureProviderField: {keep: true},
                },
                invalid: "not-an-object",
            },
            futureModelsField: [1, 2, 3],
        }))

        assert.deepEqual(result.value, {
            providers: {
                custom: {
                    baseUrl: "https://example.test/v1",
                    models: [{id: "model-1"}],
                    futureProviderField: {keep: true},
                },
            },
            futureModelsField: [1, 2, 3],
        })
        assert.deepEqual(result.diagnostics, [{
            file: "models.json",
            severity: "error",
            message: '$.providers["invalid"] must be an object',
        }])
    })

    test("auth validation returns a credential map without echoing secret values", () => {
        const secret = "secret-that-must-not-enter-diagnostics"
        const result = parseAuthJson(JSON.stringify({
            openai: {type: "api_key", key: "sk-test", futureCredentialField: true},
            broken: secret,
        }))

        assert.deepEqual(result.value, {
            openai: {type: "api_key", key: "sk-test", futureCredentialField: true},
        })
        assert.equal(result.diagnostics.length, 1)
        assert.equal(JSON.stringify(result.diagnostics).includes(secret), false)
        assert.equal(result.diagnostics[0]?.file, "auth.json")
    })

    test("credential helpers are immutable and preserve concurrent provider entries", () => {
        const original = {
            openai: {type: "api_key", key: "old"},
            anthropic: {type: "oauth", access: "keep"},
        }
        const changed = updateCredential(original, "openai", (current) => ({
            ...current,
            key: "new",
        }))
        const withThird = setCredential(changed, "custom", {
            type: "api_key",
            key: "custom-key",
        })
        const removed = deleteCredential(withThird, "openai")

        assert.equal(original.openai.key, "old")
        assert.deepEqual(getCredential(changed, "openai"), {type: "api_key", key: "new"})
        assert.deepEqual(removed, {
            anthropic: {type: "oauth", access: "keep"},
            custom: {type: "api_key", key: "custom-key"},
        })
        assert.equal(getCredential(removed, "toString"), undefined)
    })

    test("the browser root entry does not re-export the agent-only module", () => {
        const browserEntry = readFileSync(
            new URL("../src/index.ts", import.meta.url),
            "utf8",
        )
        assert.equal(browserEntry.includes("agent-settings"), false)
        assert.equal(browserEntry.includes("authJson"), false)
    })

    test("normalizeAgentSettingsSnapshot accepts wire-shaped application and project payloads", () => {
        const application = normalizeAgentSettingsSnapshot({
            scope: "application",
            projectRoot: null,
            settingsJson: '{"defaultModel":"m"}',
            vibeflyJson: undefined,
            modelsJson: null,
            authJson: null,
            revision: "r1",
            diagnostics: [
                {file: "settings.json", severity: "warning", message: "soft"},
                {file: "unknown.json", severity: "error", message: "drop"},
            ],
        })
        assert.equal(application.scope, "application")
        assert.equal(application.projectRoot, null)
        assert.equal(application.vibeflyJson, "{}")
        assert.equal(application.modelsJson, "{}")
        assert.equal(application.authJson, "{}")
        assert.deepEqual(application.diagnostics, [
            {file: "settings.json", severity: "warning", message: "soft"},
        ])

        const project = normalizeAgentSettingsSnapshot({
            scope: "project",
            projectRoot: " /tmp/p ",
            revision: "r2",
        })
        assert.equal(project.scope, "project")
        assert.equal(project.projectRoot, "/tmp/p")
        assert.equal("modelsJson" in project, false)
    })
})
