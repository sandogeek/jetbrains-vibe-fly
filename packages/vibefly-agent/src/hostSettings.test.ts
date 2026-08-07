import {describe, test} from "node:test"
import {expect} from "expect"
import type {AgentSettingsSnapshot, AuthSaveRequest, SettingsSaveResult,} from "./generated/controlRpc.js"
import {
    HostBackedCredentialStore,
    type HostModelRuntime,
    HostSettingsController,
    type HostSettingsRpc,
} from "./hostSettings.js"

function applicationSnapshot(
    revision: string,
    overrides: Partial<AgentSettingsSnapshot> = {},
): AgentSettingsSnapshot {
    return {
        scope: "application",
        projectRoot: null,
        settingsJson: "{}",
        vibeflyJson: "{}",
        modelsJson: "{}",
        authJson: "{}",
        diagnostics: [],
        revision,
        ...overrides,
    }
}

function projectSnapshot(
    revision: string,
    overrides: Partial<AgentSettingsSnapshot> = {},
): AgentSettingsSnapshot {
    return {
        scope: "project",
        projectRoot: "/workspace/project",
        settingsJson: "{}",
        vibeflyJson: "{}",
        diagnostics: [],
        revision,
        ...overrides,
    }
}

class FakeHost implements HostSettingsRpc {
    application = applicationSnapshot("app-1")
    project = projectSnapshot("project-1")
    readonly fetches: string[] = []
    readonly saves: AuthSaveRequest[] = []
    save: (request: AuthSaveRequest) => Promise<SettingsSaveResult> = async () => ({
        ok: true,
        revision: "saved",
    })

    async getSettingsSnapshot(scope: string): Promise<AgentSettingsSnapshot> {
        this.fetches.push(scope)
        return structuredClone(scope === "application" ? this.application : this.project)
    }

    async saveAuth(request: AuthSaveRequest): Promise<SettingsSaveResult> {
        this.saves.push(structuredClone(request))
        return this.save(request)
    }
}

class FakeRuntime {
    readonly registered = new Map<string, unknown>()
    readonly baseModels = new Map<string, any[]>()
    readonly calls: Array<{ kind: string; providerId?: string; options?: unknown }> = []

    registerProvider(providerId: string, config: unknown): void {
        this.calls.push({kind: "register", providerId})
        this.registered.set(providerId, structuredClone(config))
    }

    unregisterProvider(providerId: string): void {
        this.calls.push({kind: "unregister", providerId})
        this.registered.delete(providerId)
    }

    getModels(providerId?: string): any[] {
        if (!providerId) return [...this.baseModels.values()].flat()
        const registered = this.registered.get(providerId) as { models?: any[] } | undefined
        return structuredClone(registered?.models ?? this.baseModels.get(providerId) ?? [])
    }

    async refresh(options?: unknown): Promise<unknown> {
        this.calls.push({kind: "refresh", options})
        return {aborted: false, errors: new Map()}
    }

    asRuntime(): HostModelRuntime {
        return this as unknown as HostModelRuntime
    }
}

function deferred<T>(): {
    promise: Promise<T>
    resolve: (value: T) => void
} {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise
    })
    return {promise, resolve}
}

async function until(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return
        await new Promise<void>((resolve) => setImmediate(resolve))
    }
    throw new Error("condition was not reached")
}

function readStorage(
    storage: HostSettingsController["settingsStorage"],
    scope: "global" | "project",
): string | undefined {
    let value: string | undefined
    storage.withLock(scope, (current) => {
        value = current
        return undefined
    })
    return value
}

describe("HostSettingsController", () => {
    test("fetches both scopes, deep-merges settings, and registers Host models", async () => {
        const host = new FakeHost()
        host.application = applicationSnapshot("app-1", {
            settingsJson: JSON.stringify({
                compaction: {enabled: true, reserveTokens: 100},
                enabledModels: ["application/model"],
            }),
            modelsJson: JSON.stringify({
                providers: {
                    custom: {
                        baseUrl: "https://example.test/v1",
                        api: "openai-responses",
                        apiKey: "must-not-be-registered",
                        models: [{id: "demo"}],
                    },
                },
            }),
        })
        host.project = projectSnapshot("project-1", {
            settingsJson: JSON.stringify({
                compaction: {reserveTokens: 250},
                enabledModels: ["project/model"],
            }),
        })
        const controller = new HostSettingsController(host, {hasProject: true})
        await controller.initialize()

        expect(host.fetches.sort()).toEqual(["application", "project"])
        expect(JSON.parse(readStorage(controller.settingsStorage, "global")!)).toEqual({
            compaction: {enabled: true, reserveTokens: 250},
            enabledModels: ["project/model"],
        })
        expect(readStorage(controller.settingsStorage, "project")).toBe("{}")
        controller.settingsStorage.withLock("global", () => "{}")
        expect(JSON.parse(readStorage(controller.settingsStorage, "global")!)).toEqual({
            compaction: {enabled: true, reserveTokens: 250},
            enabledModels: ["project/model"],
        })

        const runtime = new FakeRuntime()
        await controller.attachModelRuntime(runtime.asRuntime())
        const config = runtime.registered.get("custom") as Record<string, any>
        expect(config.apiKey).toBeUndefined()
        expect(config.models[0]).toMatchObject({
            id: "demo",
            name: "demo",
            reasoning: false,
            input: ["text"],
            contextWindow: 128_000,
            maxTokens: 16_384,
        })
        expect(runtime.calls.at(-1)).toEqual({
            kind: "refresh",
            options: {allowNetwork: false},
        })
    })

    test("preserves builtin models and composes provider and model overrides", async () => {
        const host = new FakeHost()
        host.application = applicationSnapshot("app-models", {
            modelsJson: JSON.stringify({
                providers: {
                    openai: {
                        baseUrl: "https://host.example/v1",
                        apiKey: "must-not-be-registered",
                        secretToken: "also-must-not-be-registered",
                        compat: {
                            supportsDeveloperRole: false,
                            openRouterRouting: {order: ["provider"]},
                            chatTemplateKwargs: {provider: "yes"},
                        },
                        models: [{
                            id: "custom",
                            api: "openai-responses",
                            baseUrl: "https://custom.example/v1",
                            headers: {"X-Custom": "model"},
                            compat: {
                                supportsStore: false,
                                openRouterRouting: {only: ["custom"]},
                            },
                        }],
                        modelOverrides: {
                            builtin: {
                                name: "Builtin overridden",
                                reasoning: false,
                                thinkingLevelMap: {high: "high"},
                                cost: {output: 20},
                                headers: {"X-Override": "yes"},
                                compat: {
                                    openRouterRouting: {only: ["override"]},
                                    chatTemplateKwargs: {override: 7},
                                },
                            },
                            custom: {
                                contextWindow: 999,
                                compat: {supportsStrictMode: true},
                            },
                        },
                    },
                },
            }),
        })
        const controller = new HostSettingsController(host, {hasProject: false})
        await controller.initialize()
        const runtime = new FakeRuntime()
        runtime.baseModels.set("openai", [{
            id: "builtin",
            name: "Builtin",
            api: "openai-responses",
            provider: "openai",
            baseUrl: "https://builtin.example/v1",
            reasoning: true,
            thinkingLevelMap: {low: "low"},
            input: ["text", "image"],
            cost: {input: 1, output: 2, cacheRead: 3, cacheWrite: 4},
            contextWindow: 10_000,
            maxTokens: 1_000,
            headers: {"X-Builtin": "yes"},
            compat: {
                supportsStore: true,
                openRouterRouting: {only: ["base"], order: ["base"]},
                chatTemplateKwargs: {existing: true},
            },
        }])

        await controller.attachModelRuntime(runtime.asRuntime())

        const config = runtime.registered.get("openai") as Record<string, any>
        expect(config.apiKey).toBeUndefined()
        expect(config.secretToken).toBeUndefined()
        const models = new Map(config.models.map((model: any) => [model.id, model]))
        expect([...models.keys()]).toEqual(["builtin", "custom"])
        expect(models.get("builtin")).toMatchObject({
            name: "Builtin overridden",
            baseUrl: "https://host.example/v1",
            reasoning: false,
            thinkingLevelMap: {low: "low", high: "high"},
            input: ["text", "image"],
            cost: {input: 1, output: 20, cacheRead: 3, cacheWrite: 4},
            headers: {"X-Builtin": "yes", "X-Override": "yes"},
            compat: {
                supportsStore: true,
                supportsDeveloperRole: false,
                openRouterRouting: {only: ["override"], order: ["provider"]},
                chatTemplateKwargs: {existing: true, provider: "yes", override: 7},
            },
        })
        expect(models.get("custom")).toMatchObject({
            baseUrl: "https://custom.example/v1",
            contextWindow: 999,
            headers: {"X-Custom": "model"},
            compat: {
                supportsStore: false,
                supportsDeveloperRole: false,
                supportsStrictMode: true,
                openRouterRouting: {only: ["custom"], order: ["provider"]},
            },
        })
    })

    test("ignores diagnostics-only revisions and converges serial notifications", async () => {
        const host = new FakeHost()
        const reloads: string[] = []
        const controller = new HostSettingsController(host, {
            hasProject: true,
            reloadLiveSessions: async () => {
                reloads.push("reload")
            },
        })
        await controller.initialize()
        const runtime = new FakeRuntime()
        await controller.attachModelRuntime(runtime.asRuntime())
        runtime.calls.length = 0
        host.fetches.length = 0

        host.application = applicationSnapshot("app-diagnostic", {
            diagnostics: [{file: "settings.json", severity: "warning", message: "temporary"}],
        })
        await controller.handleSettingsChanged("application", null, "app-diagnostic")
        await controller.handleSettingsChanged("application", null, "app-diagnostic")
        expect(reloads).toEqual([])
        expect(runtime.calls).toEqual([])
        expect(host.fetches).toEqual(["application"])

        host.project = projectSnapshot("project-2", {
            settingsJson: JSON.stringify({compaction: {enabled: true}}),
        })
        const first = controller.handleSettingsChanged(
            "project",
            "/workspace/project",
            "project-2",
        )
        host.project = projectSnapshot("project-3", {
            settingsJson: JSON.stringify({compaction: {enabled: false}}),
        })
        const second = controller.handleSettingsChanged(
            "project",
            "/workspace/project",
            "project-3",
        )
        await Promise.all([first, second])

        expect(reloads).toEqual(["reload"])
        expect(JSON.parse(readStorage(controller.settingsStorage, "global")!))
            .toEqual({compaction: {enabled: false}})
    })

    test("applies model add, change, and removal with one live reload per snapshot", async () => {
        const host = new FakeHost()
        host.application = applicationSnapshot("app-1", {
            modelsJson: JSON.stringify({
                providers: {one: {api: "openai-responses", models: [{id: "v1"}]}},
            }),
        })
        let reloads = 0
        const controller = new HostSettingsController(host, {
            hasProject: false,
            reloadLiveSessions: async () => {
                reloads += 1
            },
        })
        await controller.initialize()
        const runtime = new FakeRuntime()
        await controller.attachModelRuntime(runtime.asRuntime())
        runtime.calls.length = 0

        host.application = applicationSnapshot("app-2", {
            modelsJson: JSON.stringify({
                providers: {
                    one: {api: "openai-responses", models: [{id: "v2"}]},
                    two: {api: "openai-completions", models: [{id: "other"}]},
                },
            }),
        })
        await controller.handleSettingsChanged("application", null, "app-2")
        expect(runtime.calls.map((call) => `${call.kind}:${call.providerId ?? ""}`)).toEqual([
            "unregister:one",
            "register:one",
            "register:two",
            "refresh:",
        ])
        expect(reloads).toBe(1)

        runtime.calls.length = 0
        host.application = applicationSnapshot("app-3", {
            modelsJson: JSON.stringify({
                providers: {
                    two: {api: "openai-completions", models: [{id: "other"}]},
                },
            }),
        })
        await controller.handleSettingsChanged("application", null, "app-3")
        expect(runtime.calls.map((call) => `${call.kind}:${call.providerId ?? ""}`)).toEqual([
            "unregister:one",
            "refresh:",
        ])
        expect(reloads).toBe(2)
    })

    test("resolves commit defaults from the latest effective Host settings", async () => {
        const host = new FakeHost()
        host.application = applicationSnapshot("app-1", {
            settingsJson: JSON.stringify({
                defaultProvider: "default-provider",
                defaultModel: "default-model",
            }),
            vibeflyJson: JSON.stringify({
                commit: {
                    languageMode: "zh",
                    commitModelSpec: "commit-provider/commit-model",
                    useCustomPrompt: true,
                    customPrompt: "Configured prompt",
                },
            }),
        })
        const controller = new HostSettingsController(host, {hasProject: false})
        await controller.initialize()

        expect(controller.applyCommitSettings({
            files: [],
            language: "en",
        })).toMatchObject({
            commitModel: "commit-provider/commit-model",
            defaultModel: "default-provider/default-model",
            language: "zh",
            customPrompt: "Configured prompt",
        })
    })

    test("re-reads both scopes after registration and applies missed startup changes", async () => {
        const host = new FakeHost()
        let reloads = 0
        const controller = new HostSettingsController(host, {
            hasProject: true,
            reloadLiveSessions: async () => {
                reloads += 1
            },
        })
        await controller.initialize()
        const runtime = new FakeRuntime()
        await controller.attachModelRuntime(runtime.asRuntime())
        runtime.calls.length = 0
        host.fetches.length = 0

        host.application = applicationSnapshot("app-2", {
            settingsJson: JSON.stringify({compaction: {enabled: true}}),
            modelsJson: JSON.stringify({
                providers: {
                    custom: {
                        api: "openai-responses",
                        baseUrl: "https://example.test/v1",
                        models: [{id: "new-model"}],
                    },
                },
            }),
            authJson: JSON.stringify({
                custom: {type: "api_key", key: "latest"},
            }),
        })
        host.project = projectSnapshot("project-2", {
            settingsJson: JSON.stringify({compaction: {reserveTokens: 500}}),
        })

        await controller.refreshFromHost()

        expect(host.fetches.sort()).toEqual(["application", "project"])
        expect(JSON.parse(readStorage(controller.settingsStorage, "global")!)).toEqual({
            compaction: {enabled: true, reserveTokens: 500},
        })
        expect(await controller.credentials.read("custom")).toEqual({
            type: "api_key",
            key: "latest",
        })
        expect(runtime.registered.has("custom")).toBe(true)
        expect(reloads).toBe(1)
    })
})

describe("HostBackedCredentialStore", () => {
    test("re-fetches on conflict and replays only the target provider mutation", async () => {
        const host = new FakeHost()
        host.application = applicationSnapshot("rev-1", {
            authJson: JSON.stringify({
                target: {type: "api_key", key: "old"},
                other: {type: "api_key", key: "before"},
            }),
        })
        let saveAttempt = 0
        host.save = async (request) => {
            saveAttempt += 1
            if (saveAttempt === 1) {
                host.application = applicationSnapshot("rev-2", {
                    authJson: JSON.stringify({
                        target: {type: "api_key", key: "latest"},
                        other: {type: "api_key", key: "concurrent"},
                    }),
                })
                return {ok: false, conflict: true, revision: "rev-2"}
            }
            return {ok: true, revision: "rev-3"}
        }
        const persisted: string[] = []
        const store = new HostBackedCredentialStore(host, (revision) => {
            persisted.push(revision)
        })
        await store.replace(host.application.authJson!, host.application.revision)
        let replays = 0

        const result = await store.modify("target", async (current) => {
            replays += 1
            const key = current?.type === "api_key" ? current.key : "missing"
            return {type: "api_key", key: `${key}-updated`}
        })

        expect(replays).toBe(2)
        expect(result).toEqual({type: "api_key", key: "latest-updated"})
        expect(host.saves).toHaveLength(2)
        expect(JSON.parse(host.saves[1]!.authJson)).toEqual({
            target: {type: "api_key", key: "latest-updated"},
            other: {type: "api_key", key: "concurrent"},
        })
        expect(host.saves[1]!.expectedRevision).toBe("rev-2")
        expect(persisted).toEqual(["rev-3"])

        host.save = async () => ({ok: true, revision: "rev-4"})
        await store.delete("target")
        expect(await store.read("target")).toBeUndefined()
        expect(await store.read("other")).toEqual({type: "api_key", key: "concurrent"})
    })

    test("serializes Host replacement with an in-flight provider mutation", async () => {
        const host = new FakeHost()
        host.application = applicationSnapshot("rev-1", {
            authJson: JSON.stringify({
                target: {type: "api_key", key: "old"},
                other: {type: "api_key", key: "before"},
            }),
        })
        const updaterEntered = deferred<void>()
        const releaseUpdater = deferred<void>()
        let saveAttempt = 0
        host.save = async (request) => {
            saveAttempt += 1
            if (saveAttempt === 1) {
                return {ok: false, conflict: true, revision: "rev-2"}
            }
            host.application = applicationSnapshot("rev-3", {authJson: request.authJson})
            return {ok: true, revision: "rev-3"}
        }
        const store = new HostBackedCredentialStore(host)
        await store.replace(host.application.authJson!, host.application.revision)
        let replays = 0

        const mutation = store.modify("target", async (current) => {
            replays += 1
            if (replays === 1) {
                updaterEntered.resolve()
                await releaseUpdater.promise
            }
            const key = current?.type === "api_key" ? current.key : "missing"
            return {type: "api_key", key: `${key}-updated`}
        })
        await updaterEntered.promise
        host.application = applicationSnapshot("rev-2", {
            authJson: JSON.stringify({
                target: {type: "api_key", key: "latest"},
                other: {type: "api_key", key: "concurrent"},
            }),
        })
        const staleReplacement = store.replace(
            host.application.authJson!,
            host.application.revision,
        )
        releaseUpdater.resolve()

        await Promise.all([mutation, staleReplacement])

        expect(replays).toBe(2)
        expect(host.saves.map((save) => save.expectedRevision)).toEqual(["rev-1", "rev-2"])
        expect(await store.read("target")).toEqual({
            type: "api_key",
            key: "latest-updated",
        })
        expect(await store.read("other")).toEqual({
            type: "api_key",
            key: "concurrent",
        })
    })

    test("successful persistence converges the controller snapshot and reloads once", async () => {
        const host = new FakeHost()
        host.application = applicationSnapshot("rev-1", {
            authJson: JSON.stringify({target: {type: "api_key", key: "old"}}),
        })
        let reloads = 0
        const controller = new HostSettingsController(host, {
            hasProject: false,
            reloadLiveSessions: async () => {
                reloads += 1
            },
        })
        await controller.initialize()
        const runtime = new FakeRuntime()
        await controller.attachModelRuntime(runtime.asRuntime())
        runtime.calls.length = 0
        let notification: Promise<void> | undefined
        host.save = async (request) => {
            host.application = applicationSnapshot("rev-2", {authJson: request.authJson})
            notification = controller.handleSettingsChanged("application", null, "rev-2")
            return {ok: true, revision: "rev-2"}
        }

        await controller.credentials.modify("target", async () => ({
            type: "api_key",
            key: "new",
        }))
        await notification
        await until(() => controller.getApplicationSnapshot().revision === "rev-2")
        await new Promise<void>((resolve) => setImmediate(resolve))
        await new Promise<void>((resolve) => setImmediate(resolve))

        expect(controller.getApplicationSnapshot().revision).toBe("rev-2")
        expect(await controller.credentials.read("target")).toEqual({
            type: "api_key",
            key: "new",
        })
        expect(runtime.calls).toEqual([{
            kind: "refresh",
            options: {allowNetwork: false},
        }])
        expect(reloads).toBe(1)
    })

    test("project invalidation cannot roll back newly persisted application credentials", async () => {
        const host = new FakeHost()
        host.application = applicationSnapshot("app-1", {
            authJson: JSON.stringify({target: {type: "api_key", key: "old"}}),
        })
        const controller = new HostSettingsController(host, {hasProject: true})
        await controller.initialize()
        host.save = async (request) => {
            host.application = applicationSnapshot("app-2", {authJson: request.authJson})
            return {ok: true, revision: "app-2"}
        }

        await controller.credentials.modify("target", async () => ({
            type: "api_key",
            key: "new",
        }))
        host.project = projectSnapshot("project-2")
        await controller.handleSettingsChanged(
            "project",
            "/workspace/project",
            "project-2",
        )

        expect(await controller.credentials.read("target")).toEqual({
            type: "api_key",
            key: "new",
        })

        await until(() => controller.getApplicationSnapshot().revision === "app-2")
        expect(await controller.credentials.read("target")).toEqual({
            type: "api_key",
            key: "new",
        })
    })
})
