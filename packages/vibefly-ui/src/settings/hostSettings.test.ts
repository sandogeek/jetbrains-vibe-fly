import {describe, test} from "node:test"
import {expect} from "expect"
import {
    type SafeSettingsSnapshot,
    settingKeys,
    SettingsSyncClient,
    setSetting,
    unsetSetting,
} from "@vibefly/uiagent-shared"
import type {
    SettingsSaveRequest,
    SettingsSaveResult,
    Ui2Host,
    UiSettingsSnapshot,
} from "../generated/rpc"
import {safeUiSettingsSnapshot, settingsFromState} from "./hostSettings"
import {UiSettingsRuntime} from "./UiSettingsRuntime"

function application(
    revision: string,
    settingsJson = "{}",
    vibeflyJson = "{}",
): UiSettingsSnapshot {
    return {
        scope: "application",
        projectRoot: null,
        settingsJson,
        vibeflyJson,
        revision,
        diagnostics: [],
    }
}

function project(
    revision: string,
    settingsJson = "{}",
    vibeflyJson = "{}",
): UiSettingsSnapshot {
    return {
        scope: "project",
        projectRoot: "/workspace/project",
        settingsJson,
        vibeflyJson,
        revision,
        diagnostics: [],
    }
}

class FakeHost {
    application = application("app-1")
    project = project("project-1")
    saves: SettingsSaveRequest[] = []
    saveImpl?: (request: SettingsSaveRequest) => Promise<SettingsSaveResult>

    async getSettingsSnapshot(scope: string): Promise<UiSettingsSnapshot> {
        return structuredClone(scope === "application" ? this.application : this.project)
    }

    async saveSettings(request: SettingsSaveRequest): Promise<SettingsSaveResult> {
        this.saves.push(structuredClone(request))
        if (this.saveImpl) return this.saveImpl(request)
        const revision = `app-${this.saves.length + 1}`
        this.application = application(
            revision,
            request.settingsJson ?? this.application.settingsJson,
            request.vibeflyJson ?? this.application.vibeflyJson,
        )
        return {ok: true, revision}
    }

    asHost(): Ui2Host {
        return this as unknown as Ui2Host
    }
}

describe("UI settings projection", () => {
    test("normalizes wire snapshots and preserves unknown object fields", () => {
        const raw = application(
            "application-raw",
            JSON.stringify({defaultProvider: "openai", futureSettings: {nested: true}}),
            JSON.stringify({ui: {locale: "zh"}, futureVibefly: {flag: 1}}),
        )
        const snapshot = safeUiSettingsSnapshot(raw)
        expect(JSON.parse(snapshot.settingsJson)).toEqual({
            defaultProvider: "openai",
            futureSettings: {nested: true},
        })
        expect(JSON.parse(snapshot.vibeflyJson)).toEqual({
            ui: {locale: "zh"},
            futureVibefly: {flag: 1},
        })

        expect(safeUiSettingsSnapshot(application("invalid", "[1,2]", "not-json")))
            .toMatchObject({settingsJson: "{}", vibeflyJson: "{}"})
    })

    test("maps effective fields while keeping model preferences application-scoped", async () => {
        const snapshots: Record<"application" | "project", SafeSettingsSnapshot> = {
            application: safeUiSettingsSnapshot(application(
                "app-1",
                JSON.stringify({defaultProvider: "application-provider"}),
                JSON.stringify({
                    modelPreferences: {
                        pinnedModelSpecs: ["application/pinned"],
                        recentModelSpecs: ["application/recent"],
                    },
                    ui: {locale: "en"},
                }),
            )),
            project: safeUiSettingsSnapshot(project(
                "project-1",
                JSON.stringify({defaultModel: "project-model"}),
                JSON.stringify({
                    modelPreferences: {
                        pinnedModelSpecs: ["project/pinned"],
                        recentModelSpecs: ["project/recent"],
                    },
                    ui: {locale: "zh"},
                }),
            )),
        }
        const client = new SettingsSyncClient({
            async fetch(scope) {
                return snapshots[scope]
            },
        })
        const state = await client.start({hasProject: true})

        expect(settingsFromState(state)).toEqual({
            providers: {defaultProvider: "application-provider", defaultModel: "project-model"},
            commit: {
                languageMode: "follow_ide",
                commitModelSpec: "",
                useCustomPrompt: false,
                customPrompt: "",
            },
            modelPreferences: {
                pinnedModelSpecs: ["application/pinned"],
                recentModelSpecs: ["application/recent"],
            },
            ui: {locale: "zh"},
        })
    })
})

describe("UiSettingsRuntime", () => {
    test("publishes optimistic typed mutations and converges to the Host snapshot", async () => {
        const host = new FakeHost()
        const runtime = new UiSettingsRuntime(host.asHost())
        await runtime.start(false)

        const saving = runtime.mutate([
            setSetting(settingKeys.ui.locale, "zh"),
            setSetting(settingKeys.defaultProvider, "openai"),
        ])
        expect(runtime.getView().settings).toMatchObject({
            providers: {defaultProvider: "openai"},
            ui: {locale: "zh"},
        })
        await saving

        expect(host.saves).toHaveLength(1)
        expect(JSON.parse(host.saves[0]!.settingsJson!)).toEqual({defaultProvider: "openai"})
        expect(JSON.parse(host.saves[0]!.vibeflyJson!)).toEqual({ui: {locale: "zh"}})
        expect(runtime.getView().applicationRevision).toBe("app-2")
    })

    test("keeps a newer optimistic value when an earlier save completes", async () => {
        const host = new FakeHost()
        const runtime = new UiSettingsRuntime(host.asHost())
        await runtime.start(false)

        const first = runtime.mutate([setSetting(settingKeys.commit.customPrompt, "first")])
        const second = runtime.mutate([setSetting(settingKeys.commit.customPrompt, "second")])
        await Promise.all([first, second])

        expect(runtime.getView().settings.commit.customPrompt).toBe("second")
        expect(host.saves).toHaveLength(2)
    })

    test("optimistically restores inheritance with an unset mutation", async () => {
        const host = new FakeHost()
        host.application = application("app-1", "{}", JSON.stringify({ui: {locale: "zh"}}))
        const runtime = new UiSettingsRuntime(host.asHost())
        await runtime.start(false)

        const saving = runtime.mutate([unsetSetting(settingKeys.ui.locale)])
        expect(runtime.getView().settings.ui.locale).toBe("follow_ide")
        await saving

        expect(JSON.parse(host.saves[0]!.vibeflyJson!)).toEqual({ui: {}})
    })

    test("replays a staged debounce draft over an external snapshot", async () => {
        const host = new FakeHost()
        const runtime = new UiSettingsRuntime(host.asHost())
        await runtime.start(false)
        runtime.stage([setSetting(settingKeys.ui.locale, "zh")])

        host.application = application(
            "app-external",
            JSON.stringify({defaultProvider: "external"}),
        )
        await runtime.notify("application", null, "app-external")

        expect(runtime.getView().settings).toMatchObject({
            providers: {defaultProvider: "external"},
            ui: {locale: "zh"},
        })
    })

    test("persist writes without restaging, so the view stays host-backed until save returns", async () => {
        const host = new FakeHost()
        const runtime = new UiSettingsRuntime(host.asHost())
        await runtime.start(false)

        const saving = runtime.persist([setSetting(settingKeys.ui.locale, "zh")])
        expect(runtime.getView().settings.ui.locale).toBe("follow_ide")
        await saving

        expect(host.saves).toHaveLength(1)
        expect(JSON.parse(host.saves[0]!.vibeflyJson!)).toEqual({ui: {locale: "zh"}})
        expect(runtime.getView().settings.ui.locale).toBe("zh")
    })
})
