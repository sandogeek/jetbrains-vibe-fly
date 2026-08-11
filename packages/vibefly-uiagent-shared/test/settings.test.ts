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
    updateJsonAtPath,
} from "../src/settings/schema.js"
import {settingKeys} from "../src/settings/keys.js"
import {setSetting, unsetSetting} from "../src/settings/mutation.js"
import {
    selectSetting,
    SettingsSyncClient,
    type SettingsDocumentSaveRequest,
    type SettingsSaveOutcome,
    type SettingsSyncAdapter,
} from "../src/settings/sync-client.js"

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

class MutableAdapter implements SettingsSyncAdapter {
    readonly calls: SettingsChanged["scope"][] = []
    readonly saves: SettingsDocumentSaveRequest[] = []
    saveImpl?: (request: SettingsDocumentSaveRequest) => Promise<SettingsSaveOutcome>

    constructor(
        public applicationSnapshot: SafeApplicationSettingsSnapshot,
        public projectSnapshot?: SafeProjectSettingsSnapshot,
    ) {
    }

    async fetch(scope: SettingsChanged["scope"]): Promise<SafeSettingsSnapshot> {
        this.calls.push(scope)
        if (scope === "application") return this.applicationSnapshot
        if (!this.projectSnapshot) throw new Error("project snapshot unavailable")
        return this.projectSnapshot
    }

    async save(request: SettingsDocumentSaveRequest): Promise<SettingsSaveOutcome> {
        this.saves.push(structuredClone(request))
        if (!this.saveImpl) throw new Error("save unavailable")
        return this.saveImpl(request)
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

    test("recursively validates schema objects without dropping unknown fields", () => {
        const result = parsePiSettingsJson(JSON.stringify({
            retry: {
                enabled: true,
                provider: "invalid",
                futureRetryField: "keep",
            },
            terminal: "invalid",
            packages: [
                "@scope/valid-package",
                {autoload: true},
                {source: "git:valid/repository", futurePackageField: true},
            ],
            futurePiField: true,
        }))

        assert.deepEqual(result.value, {
            retry: {
                enabled: true,
                futureRetryField: "keep",
            },
            packages: [
                "@scope/valid-package",
                {source: "git:valid/repository", futurePackageField: true},
            ],
            futurePiField: true,
        })
        assert.deepEqual(result.diagnostics.map((item) => item.message), [
            "$.packages[1] must be a string or package source object",
            "$.retry.provider must be an object",
            "$.terminal must be an object",
        ])

        const allInvalid = parsePiSettingsJson(JSON.stringify({
            packages: [{autoload: true}],
        }))
        assert.deepEqual(allInvalid.value, {packages: []})
        assert.deepEqual(allInvalid.diagnostics.map((item) => item.message), [
            "$.packages[0] must be a string or package source object",
        ])

        const invalidStringArray = parsePiSettingsJson(JSON.stringify({
            enabledModels: ["openai/gpt-test", 42],
        }))
        assert.deepEqual(invalidStringArray.value, {})
        assert.deepEqual(invalidStringArray.diagnostics.map((item) => item.message), [
            "$.enabledModels must be an array of strings",
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

describe("SettingsSyncClient cache and invalidation", () => {
    test("initializes both scopes once and exposes the effective cache", async () => {
        const adapter = new MutableAdapter(
            application("app-1", {defaultProvider: "app"}),
            project("project-1", {defaultModel: "project-model"}),
        )
        const client = new SettingsSyncClient(adapter)
        const revisions: string[] = []
        client.subscribe((state) => state.effective.revision, (revision) => revisions.push(revision))

        const state = await client.start({hasProject: true})

        assert.deepEqual(adapter.calls, ["application", "project"])
        assert.deepEqual(state.effective.settings, {
            defaultProvider: "app",
            defaultModel: "project-model",
        })
        assert.equal(client.getSnapshot("application").revision, "app-1")
        assert.equal(client.getSnapshot("project")?.revision, "project-1")
        assert.equal(client.getState(), state)
        assert.deepEqual(revisions, [JSON.stringify(["app-1", "project-1"])])
    })

    test("application and project invalidations both replace the effective cache", async () => {
        const adapter = new MutableAdapter(
            application("app-1", {retry: {enabled: true}}),
            project("project-1", {retry: {maxRetries: 1}}),
        )
        const client = new SettingsSyncClient(adapter)
        await client.start({hasProject: true})

        adapter.applicationSnapshot = application("app-2", {retry: {enabled: false}})
        await client.notify({
            scope: "application",
            projectRoot: null,
            revision: "app-2",
        })
        assert.deepEqual(client.getState().effective.settings.retry, {
            enabled: false,
            maxRetries: 1,
        })
        assert.equal(client.getState().effective.revision,
            JSON.stringify(["app-2", "project-1"]),
        )

        adapter.projectSnapshot = project("project-2", {retry: {maxRetries: 5}})
        await client.notify({
            scope: "project",
            projectRoot: "/workspace/project",
            revision: "project-2",
        })
        assert.deepEqual(client.getState().effective.settings.retry, {
            enabled: false,
            maxRetries: 5,
        })
        assert.equal(client.getState().effective.revision,
            JSON.stringify(["app-2", "project-2"]),
        )
    })

    test("ignores duplicate revisions and notifications for another project", async () => {
        const adapter = new MutableAdapter(application("app-1"), project("project-1"))
        const client = new SettingsSyncClient(adapter)
        await client.start({hasProject: true})

        await client.notify({
            scope: "application",
            projectRoot: null,
            revision: "app-1",
        })
        await client.notify({
            scope: "project",
            projectRoot: "/workspace/other",
            revision: "project-2",
        })

        assert.deepEqual(adapter.calls, ["application", "project"])
    })

    test("settles a stale notification after a newer cached snapshot", async () => {
        let calls = 0
        const adapter: SettingsSyncAdapter = {
            async fetch() {
                calls += 1
                if (calls > 4) throw new Error("stale notification did not settle")
                return application("app-3", {defaultModel: "current"})
            },
        }
        const client = new SettingsSyncClient(adapter)
        await client.start({hasProject: false})

        await client.notify({
            scope: "application",
            projectRoot: null,
            revision: "app-2",
        })

        assert.equal(calls, 4)
        assert.equal(client.getSnapshot("application").revision, "app-3")
        assert.equal(client.getState().effective.settings.defaultModel, "current")
    })

    test("retries propagation lag until the notified revision is fetched", async () => {
        const calls: SettingsChanged["scope"][] = []
        const snapshots = [
            application("app-1"),
            application("app-1"),
            application("app-2", {defaultModel: "new"}),
        ]
        const adapter: SettingsSyncAdapter = {
            async fetch(scope) {
                calls.push(scope)
                const snapshot = snapshots.shift()
                if (!snapshot) throw new Error("unexpected fetch")
                return snapshot
            },
        }
        const client = new SettingsSyncClient(adapter)
        await client.start({hasProject: false})

        await client.notify({
            scope: "application",
            projectRoot: null,
            revision: "app-2",
        })

        assert.deepEqual(calls, ["application", "application", "application"])
        assert.equal(client.getSnapshot("application").revision, "app-2")
    })

    test("does not mistake a repeatedly cached starting revision for a newer one", async () => {
        const calls: SettingsChanged["scope"][] = []
        const snapshots = [
            application("app-1"),
            application("app-1"),
            application("app-1"),
            application("app-2", {defaultModel: "new"}),
        ]
        const adapter: SettingsSyncAdapter = {
            async fetch(scope) {
                calls.push(scope)
                const snapshot = snapshots.shift()
                if (!snapshot) throw new Error("unexpected fetch")
                return snapshot
            },
        }
        const client = new SettingsSyncClient(adapter)
        await client.start({hasProject: false})

        await client.notify({
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
        assert.equal(client.getSnapshot("application").revision, "app-2")
    })

    test("a different revision received during refresh forces another fetch", async () => {
        const firstRefresh = deferred<SafeSettingsSnapshot>()
        const calls: SettingsChanged["scope"][] = []
        let applicationCall = 0
        const adapter: SettingsSyncAdapter = {
            async fetch(scope) {
                calls.push(scope)
                applicationCall += 1
                if (applicationCall === 1) return application("app-1")
                if (applicationCall === 2) return firstRefresh.promise
                if (applicationCall === 3) return application("app-3", {defaultModel: "three"})
                throw new Error("unexpected fetch")
            },
        }
        const client = new SettingsSyncClient(adapter)
        await client.start({hasProject: false})

        const refreshToTwo = client.notify({
            scope: "application",
            projectRoot: null,
            revision: "app-2",
        })
        await until(() => applicationCall === 2)
        const refreshToThree = client.notify({
            scope: "application",
            projectRoot: null,
            revision: "app-3",
        })
        firstRefresh.resolve(application("app-2", {defaultModel: "two"}))

        await Promise.all([refreshToTwo, refreshToThree])
        assert.deepEqual(calls, ["application", "application", "application"])
        assert.equal(client.getSnapshot("application").revision, "app-3")
        assert.equal(client.getState().effective.settings.defaultModel, "three")
    })

    test("application-only managers never request or accept project snapshots", async () => {
        const adapter = new MutableAdapter(application("app-1"))
        const client = new SettingsSyncClient(adapter)
        await client.start({hasProject: false})
        await client.notify({
            scope: "project",
            projectRoot: "/workspace/project",
            revision: "project-1",
        })

        assert.deepEqual(adapter.calls, ["application"])
        assert.equal(client.getSnapshot("project"), undefined)
        assert.equal(client.getState().effective.projectRevision, null)
    })
})

describe("SettingsSyncClient mutations and typed keys", () => {
    test("queues notifications received before start and publishes selected values only when changed", async () => {
        const adapter = new MutableAdapter(application("app-1", {}, {ui: {locale: "en"}}))
        const client = new SettingsSyncClient(adapter)
        const locales: string[] = []
        client.subscribe(selectSetting(settingKeys.uiLocale), (locale) => locales.push(locale))

        adapter.applicationSnapshot = application("app-2", {}, {ui: {locale: "zh"}})
        await client.notify({scope: "application", projectRoot: null, revision: "app-2"})
        await client.start({hasProject: false})
        adapter.applicationSnapshot = {
            ...application("app-3", {}, {ui: {locale: "zh"}}),
            diagnostics: [{file: "settings.json", severity: "warning", message: "diagnostic only"}],
        }
        await client.notify({scope: "application", projectRoot: null, revision: "app-3"})

        assert.deepEqual(locales, ["zh"])
        assert.equal(client.getSnapshot("application").revision, "app-3")
    })

    test("saves both documents atomically and preserves unknown fields", async () => {
        const adapter = new MutableAdapter(application(
            "app-1",
            {defaultProvider: "old", futurePi: {keep: true}},
            {commit: {customPrompt: "old"}, futureProduct: true},
        ))
        adapter.saveImpl = async (request) => {
            adapter.applicationSnapshot = application(
                "app-2",
                request.settingsJson ?? adapter.applicationSnapshot.settingsJson,
                request.vibeflyJson ?? adapter.applicationSnapshot.vibeflyJson,
            )
            return {ok: true, revision: "app-2"}
        }
        const client = new SettingsSyncClient(adapter)
        await client.start({hasProject: false})

        const result = await client.mutate("application", [
            setSetting(settingKeys.defaultProvider, "openai"),
            setSetting(settingKeys.commitCustomPrompt, "new"),
        ])

        assert.equal(result.ok, true)
        assert.equal(adapter.saves.length, 1)
        assert.deepEqual(JSON.parse(adapter.saves[0]!.settingsJson!), {
            defaultProvider: "openai",
            futurePi: {keep: true},
        })
        assert.deepEqual(JSON.parse(adapter.saves[0]!.vibeflyJson!), {
            commit: {customPrompt: "new"},
            futureProduct: true,
        })
    })

    test("refetches and replays semantic mutations after a conflict", async () => {
        const adapter = new MutableAdapter(application("app-1", {future: "one"}, {ui: {locale: "en"}}))
        let saveCall = 0
        adapter.saveImpl = async (request) => {
            saveCall += 1
            if (saveCall === 1) {
                adapter.applicationSnapshot = application("app-2", {future: "external"}, {ui: {locale: "en"}})
                return {ok: false, conflict: true, revision: "app-2"}
            }
            adapter.applicationSnapshot = application(
                "app-3",
                request.settingsJson ?? adapter.applicationSnapshot.settingsJson,
                request.vibeflyJson ?? adapter.applicationSnapshot.vibeflyJson,
            )
            return {ok: true, revision: "app-3"}
        }
        const client = new SettingsSyncClient(adapter)
        await client.start({hasProject: false})

        const result = await client.mutate("application", [
            setSetting(settingKeys.uiLocale, "zh"),
            unsetSetting(settingKeys.defaultProvider),
        ])

        assert.equal(result.attempts, 2)
        assert.deepEqual(JSON.parse(adapter.saves[1]!.settingsJson!), {future: "external"})
        assert.equal(selectSetting(settingKeys.uiLocale)(client.getState()), "zh")
    })

    test("reports retry exhaustion after four conflicts", async () => {
        const adapter = new MutableAdapter(application("app-1"))
        let revision = 1
        adapter.saveImpl = async () => {
            revision += 1
            adapter.applicationSnapshot = application(`app-${revision}`, {
                external: revision,
            })
            return {ok: false, conflict: true, revision: `app-${revision}`}
        }
        const client = new SettingsSyncClient(adapter)
        await client.start({hasProject: false})

        const result = await client.mutate("application", [
            setSetting(settingKeys.defaultModel, "local-model"),
        ])

        assert.deepEqual(result, {
            ok: false,
            revision: "app-5",
            attempts: 4,
            conflict: true,
            error: "Settings changed externally",
        })
        assert.equal(adapter.saves.length, 4)
    })

    test("serializes one scope while allowing application and project to fetch in parallel", async () => {
        let active = 0
        let maxActive = 0
        const release = deferred<void>()
        const entered = deferred<void>()
        const adapter: SettingsSyncAdapter = {
            async fetch(scope) {
                active += 1
                maxActive = Math.max(maxActive, active)
                if (active === 2) entered.resolve()
                await release.promise
                active -= 1
                return scope === "application" ? application("app-1") : project("project-1")
            },
        }
        const client = new SettingsSyncClient(adapter)
        const starting = client.start({hasProject: true})
        await entered.promise
        assert.equal(maxActive, 2)
        release.resolve()
        await starting
    })
})
