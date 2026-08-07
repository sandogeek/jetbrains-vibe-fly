import assert from "node:assert/strict"
import {describe, test} from "node:test"
import {
    aggregateSettingsDiagnostics,
    computeEffectiveSettings,
    deepMergeJsonObjects,
    type JsonObject,
    parsePiSettingsJson,
    parseVibeflySettingsJson,
    type SafeApplicationSettingsSnapshot,
    type SafeProjectSettingsSnapshot,
    type SafeSettingsSnapshot,
    setJsonAtPath,
    type SettingsChanged,
    SettingsManager,
    type SettingsManagerAdapter,
    updateJsonAtPath,
} from "../src/settings.js"

function application(
    revision: string,
    settings: JsonObject | string = {},
    vibefly: JsonObject | string = {},
): SafeApplicationSettingsSnapshot {
    return {
        scope: "application",
        projectRoot: null,
        settingsJson: typeof settings === "string" ? settings : JSON.stringify(settings),
        vibeflyJson: typeof vibefly === "string" ? vibefly : JSON.stringify(vibefly),
        revision,
        diagnostics: [],
    }
}

function project(
    revision: string,
    settings: JsonObject | string = {},
    vibefly: JsonObject | string = {},
    projectRoot = "/workspace/project",
): SafeProjectSettingsSnapshot {
    return {
        scope: "project",
        projectRoot,
        settingsJson: typeof settings === "string" ? settings : JSON.stringify(settings),
        vibeflyJson: typeof vibefly === "string" ? vibefly : JSON.stringify(vibefly),
        revision,
        diagnostics: [],
    }
}

class MutableAdapter implements SettingsManagerAdapter {
    readonly calls: SettingsChanged["scope"][] = []

    constructor(
        public applicationSnapshot: SafeApplicationSettingsSnapshot,
        public projectSnapshot?: SafeProjectSettingsSnapshot,
    ) {
    }

    async getSettingsSnapshot(scope: SettingsChanged["scope"]): Promise<SafeSettingsSnapshot> {
        this.calls.push(scope)
        if (scope === "application") return this.applicationSnapshot
        if (!this.projectSnapshot) throw new Error("project snapshot unavailable")
        return this.projectSnapshot
    }
}

function deferred<T>(): {
    promise: Promise<T>
    resolve: (value: T) => void
    reject: (error: unknown) => void
} {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return {promise, resolve, reject}
}

async function until(predicate: () => boolean): Promise<void> {
    for (let index = 0; index < 100; index += 1) {
        if (predicate()) return
        await new Promise<void>((resolve) => setImmediate(resolve))
    }
    throw new Error("condition was not reached")
}

describe("settings JSON merge and immutable updates", () => {
    test("recursively merges objects and replaces arrays, scalars, and null", () => {
        const base: JsonObject = {
            nested: {
                keep: true,
                deeper: {fromApplication: 1},
                array: [1, 2],
            },
            scalar: "application",
            nullable: {inherited: true},
        }
        const override: JsonObject = {
            nested: {
                deeper: {fromProject: 2},
                array: [3],
            },
            scalar: 42,
            nullable: null,
        }

        const merged = deepMergeJsonObjects(base, override)

        assert.deepEqual(merged, {
            nested: {
                keep: true,
                deeper: {fromApplication: 1, fromProject: 2},
                array: [3],
            },
            scalar: 42,
            nullable: null,
        })
        assert.deepEqual(base, {
            nested: {
                keep: true,
                deeper: {fromApplication: 1},
                array: [1, 2],
            },
            scalar: "application",
            nullable: {inherited: true},
        })
    })

    test("set/update preserve unknown siblings without mutating the source", () => {
        const source: JsonObject = {
            futureTopLevel: {keep: "yes"},
            ui: {locale: "follow_ide", futureUiField: 7},
        }
        const updated = setJsonAtPath(source, ["ui", "locale"], "zh")
        const incremented = updateJsonAtPath(updated, ["futureTopLevel", "count"], (current) => {
            return typeof current === "number" ? current + 1 : 1
        })

        assert.deepEqual(source, {
            futureTopLevel: {keep: "yes"},
            ui: {locale: "follow_ide", futureUiField: 7},
        })
        assert.deepEqual(incremented, {
            futureTopLevel: {keep: "yes", count: 1},
            ui: {locale: "zh", futureUiField: 7},
        })
    })

    test("prototype-looking keys remain ordinary own JSON properties", () => {
        const updated = setJsonAtPath({}, ["__proto__", "polluted"], true)
        assert.equal(Object.prototype.hasOwnProperty("polluted"), false)
        assert.equal(Object.prototype.hasOwnProperty.call(updated, "__proto__"), true)
        assert.equal((updated.__proto__ as JsonObject).polluted, true)
    })
})

describe("settings runtime validation", () => {
    test("preserves unknown keys while removing invalid known fields", () => {
        const result = parsePiSettingsJson(JSON.stringify({
            defaultProvider: "openai",
            defaultModel: 42,
            enabledModels: ["openai/gpt-test"],
            compaction: {
                enabled: true,
                reserveTokens: "invalid",
                futureCompactionField: {keep: true},
            },
            futurePiField: {nested: [1, 2, 3]},
        }))

        assert.deepEqual(result.value, {
            defaultProvider: "openai",
            enabledModels: ["openai/gpt-test"],
            compaction: {
                enabled: true,
                futureCompactionField: {keep: true},
            },
            futurePiField: {nested: [1, 2, 3]},
        })
        assert.deepEqual(result.diagnostics.map((item) => item.message), [
            "$.defaultModel must be a string",
            "$.compaction.reserveTokens must be a non-negative number",
        ])
    })

    test("validates Vibe Fly fields and leaves future product fields intact", () => {
        const result = parseVibeflySettingsJson(JSON.stringify({
            commit: {
                languageMode: "invalid",
                customPrompt: "keep",
                futureCommitField: true,
            },
            modelPreferences: {
                pinnedModelSpecs: ["openai/gpt-test"],
            },
            ui: {locale: "zh"},
            futureProductField: {version: 2},
        }))

        assert.deepEqual(result.value, {
            commit: {
                customPrompt: "keep",
                futureCommitField: true,
            },
            modelPreferences: {
                pinnedModelSpecs: ["openai/gpt-test"],
            },
            ui: {locale: "zh"},
            futureProductField: {version: 2},
        })
        assert.equal(result.diagnostics.length, 1)
        assert.equal(result.diagnostics[0]?.file, "settings.vibefly.json")
    })

    test("preserves null for known scalar and object fields", () => {
        const pi = parsePiSettingsJson(JSON.stringify({
            defaultModel: null,
            enabledModels: null,
            retry: null,
        }))
        const vibefly = parseVibeflySettingsJson(JSON.stringify({
            commit: null,
            ui: {locale: null},
        }))

        assert.deepEqual(pi.value, {
            defaultModel: null,
            enabledModels: null,
            retry: null,
        })
        assert.deepEqual(vibefly.value, {
            commit: null,
            ui: {locale: null},
        })
        assert.deepEqual(pi.diagnostics, [])
        assert.deepEqual(vibefly.diagnostics, [])
    })

    test("validates the current pi settings enums and package source shape", () => {
        const result = parsePiSettingsJson(JSON.stringify({
            defaultThinkingLevel: "auto",
            transport: "websocket-cached",
            defaultProjectTrust: "ask",
            doubleEscapeAction: "tree",
            treeFilterMode: "no-tools",
            packages: [
                "@scope/all-resources",
                {
                    source: "git:example/repository",
                    autoload: false,
                    extensions: ["extensions/*.ts"],
                    futurePackageField: true,
                },
            ],
            markdown: {codeBlockIndent: "    "},
            warnings: {anthropicExtraUsage: false},
        }))

        assert.equal(result.value.defaultThinkingLevel, undefined)
        assert.equal(result.value.transport, "websocket-cached")
        assert.deepEqual(result.value.packages, [
            "@scope/all-resources",
            {
                source: "git:example/repository",
                autoload: false,
                extensions: ["extensions/*.ts"],
                futurePackageField: true,
            },
        ])
        assert.deepEqual(result.diagnostics.map((item) => item.message), [
            "$.defaultThinkingLevel must be a supported thinking level",
        ])
    })

    test("rejects malformed JSON and non-object roots", () => {
        assert.deepEqual(parsePiSettingsJson("{").value, {})
        assert.equal(parsePiSettingsJson("{").diagnostics[0]?.severity, "error")
        assert.deepEqual(parseVibeflySettingsJson("[]").value, {})
        assert.equal(parseVibeflySettingsJson("[]").diagnostics[0]?.message,
            "Document root must be an object",
        )
    })

    test("aggregates diagnostics in stable order and removes duplicates", () => {
        const duplicate = {
            file: "settings.json" as const,
            severity: "warning" as const,
            message: "same",
        }
        assert.deepEqual(
            aggregateSettingsDiagnostics([duplicate], [duplicate], [{
                file: "settings.vibefly.json",
                severity: "error",
                message: "other",
            }]),
            [
                duplicate,
                {file: "settings.vibefly.json", severity: "error", message: "other"},
            ],
        )
    })
})

describe("effective settings", () => {
    test("merges application before project and combines both revisions", () => {
        const effective = computeEffectiveSettings(
            application(
                "app-1",
                {
                    defaultProvider: "application-provider",
                    enabledModels: ["application/model"],
                    retry: {enabled: true, provider: {maxRetries: 2, timeoutMs: 100}},
                },
                {
                    ui: {locale: "en", futureUiField: "keep"},
                    futureProductField: true,
                },
            ),
            project(
                "project-4",
                {
                    defaultProvider: "project-provider",
                    enabledModels: [],
                    retry: {provider: {timeoutMs: 250}},
                },
                {ui: {locale: null}},
            ),
        )

        assert.deepEqual(effective.settings, {
            defaultProvider: "project-provider",
            enabledModels: [],
            retry: {enabled: true, provider: {maxRetries: 2, timeoutMs: 250}},
        })
        assert.deepEqual(effective.vibefly, {
            ui: {locale: null, futureUiField: "keep"},
            futureProductField: true,
        })
        assert.equal(effective.applicationRevision, "app-1")
        assert.equal(effective.projectRevision, "project-4")
        assert.equal(effective.revision, JSON.stringify(["app-1", "project-4"]))
    })
})

describe("SettingsManager cache and invalidation", () => {
    test("initializes both scopes once and exposes the effective cache", async () => {
        const adapter = new MutableAdapter(
            application("app-1", {defaultProvider: "app"}),
            project("project-1", {defaultModel: "project-model"}),
        )
        const manager = new SettingsManager(adapter)
        const events: Array<string | null> = []
        manager.subscribe((change) => events.push(change.scope))

        const effective = await manager.initialize(true)

        assert.deepEqual(adapter.calls, ["application", "project"])
        assert.deepEqual(effective.settings, {
            defaultProvider: "app",
            defaultModel: "project-model",
        })
        assert.equal(manager.getSnapshot("application")?.revision, "app-1")
        assert.equal(manager.getSnapshot("project")?.revision, "project-1")
        assert.equal(manager.getEffectiveSettings(), effective)
        assert.deepEqual(events, [null])
    })

    test("application and project invalidations both replace the effective cache", async () => {
        const adapter = new MutableAdapter(
            application("app-1", {retry: {enabled: true}}),
            project("project-1", {retry: {maxRetries: 1}}),
        )
        const manager = new SettingsManager(adapter)
        await manager.initialize(true)

        adapter.applicationSnapshot = application("app-2", {retry: {enabled: false}})
        await manager.handleSettingsChanged({
            scope: "application",
            projectRoot: null,
            revision: "app-2",
        })
        assert.deepEqual(manager.getEffectiveSettings()?.settings.retry, {
            enabled: false,
            maxRetries: 1,
        })
        assert.equal(manager.getEffectiveSettings()?.revision,
            JSON.stringify(["app-2", "project-1"]),
        )

        adapter.projectSnapshot = project("project-2", {retry: {maxRetries: 5}})
        await manager.handleSettingsChanged({
            scope: "project",
            projectRoot: "/workspace/project",
            revision: "project-2",
        })
        assert.deepEqual(manager.getEffectiveSettings()?.settings.retry, {
            enabled: false,
            maxRetries: 5,
        })
        assert.equal(manager.getEffectiveSettings()?.revision,
            JSON.stringify(["app-2", "project-2"]),
        )
    })

    test("ignores duplicate revisions and notifications for another project", async () => {
        const adapter = new MutableAdapter(application("app-1"), project("project-1"))
        const manager = new SettingsManager(adapter)
        await manager.initialize(true)

        await manager.handleSettingsChanged({
            scope: "application",
            projectRoot: null,
            revision: "app-1",
        })
        await manager.handleSettingsChanged({
            scope: "project",
            projectRoot: "/workspace/other",
            revision: "project-2",
        })

        assert.deepEqual(adapter.calls, ["application", "project"])
    })

    test("settles a stale notification after a newer cached snapshot", async () => {
        let calls = 0
        const adapter: SettingsManagerAdapter = {
            async getSettingsSnapshot() {
                calls += 1
                if (calls > 4) throw new Error("stale notification did not settle")
                return application("app-3", {defaultModel: "current"})
            },
        }
        const manager = new SettingsManager(adapter)
        await manager.initialize(false)

        await manager.handleSettingsChanged({
            scope: "application",
            projectRoot: null,
            revision: "app-2",
        })

        assert.equal(calls, 4)
        assert.equal(manager.getSnapshot("application")?.revision, "app-3")
        assert.equal(manager.getEffectiveSettings()?.settings.defaultModel, "current")
    })

    test("retries propagation lag until the notified revision is fetched", async () => {
        const calls: SettingsChanged["scope"][] = []
        const snapshots = [
            application("app-1"),
            application("app-1"),
            application("app-2", {defaultModel: "new"}),
        ]
        const adapter: SettingsManagerAdapter = {
            async getSettingsSnapshot(scope) {
                calls.push(scope)
                const snapshot = snapshots.shift()
                if (!snapshot) throw new Error("unexpected fetch")
                return snapshot
            },
        }
        const manager = new SettingsManager(adapter)
        await manager.initialize(false)

        await manager.handleSettingsChanged({
            scope: "application",
            projectRoot: null,
            revision: "app-2",
        })

        assert.deepEqual(calls, ["application", "application", "application"])
        assert.equal(manager.getSnapshot("application")?.revision, "app-2")
    })

    test("does not mistake a repeatedly cached starting revision for a newer one", async () => {
        const calls: SettingsChanged["scope"][] = []
        const snapshots = [
            application("app-1"),
            application("app-1"),
            application("app-1"),
            application("app-2", {defaultModel: "new"}),
        ]
        const adapter: SettingsManagerAdapter = {
            async getSettingsSnapshot(scope) {
                calls.push(scope)
                const snapshot = snapshots.shift()
                if (!snapshot) throw new Error("unexpected fetch")
                return snapshot
            },
        }
        const manager = new SettingsManager(adapter)
        await manager.initialize(false)

        await manager.handleSettingsChanged({
            scope: "application",
            projectRoot: null,
            revision: "app-2",
        })

        assert.deepEqual(calls, [
            "application",
            "application",
            "application",
            "application",
        ])
        assert.equal(manager.getSnapshot("application")?.revision, "app-2")
    })

    test("a different revision received during refresh forces another fetch", async () => {
        const firstRefresh = deferred<SafeSettingsSnapshot>()
        const calls: SettingsChanged["scope"][] = []
        let applicationCall = 0
        const adapter: SettingsManagerAdapter = {
            async getSettingsSnapshot(scope) {
                calls.push(scope)
                applicationCall += 1
                if (applicationCall === 1) return application("app-1")
                if (applicationCall === 2) return firstRefresh.promise
                if (applicationCall === 3) return application("app-3", {defaultModel: "three"})
                throw new Error("unexpected fetch")
            },
        }
        const manager = new SettingsManager(adapter)
        await manager.initialize(false)

        const refreshToTwo = manager.handleSettingsChanged({
            scope: "application",
            projectRoot: null,
            revision: "app-2",
        })
        await until(() => applicationCall === 2)
        const refreshToThree = manager.handleSettingsChanged({
            scope: "application",
            projectRoot: null,
            revision: "app-3",
        })
        firstRefresh.resolve(application("app-2", {defaultModel: "two"}))

        await Promise.all([refreshToTwo, refreshToThree])
        assert.deepEqual(calls, ["application", "application", "application"])
        assert.equal(manager.getSnapshot("application")?.revision, "app-3")
        assert.equal(manager.getEffectiveSettings()?.settings.defaultModel, "three")
    })

    test("application-only managers never request or accept project snapshots", async () => {
        const adapter = new MutableAdapter(application("app-1"))
        const manager = new SettingsManager(adapter)
        await manager.initialize(false)
        await manager.handleSettingsChanged({
            scope: "project",
            projectRoot: "/workspace/project",
            revision: "project-1",
        })

        assert.deepEqual(adapter.calls, ["application"])
        assert.equal(manager.getSnapshot("project"), undefined)
        assert.equal(manager.getEffectiveSettings()?.projectRevision, null)
    })
})
