import {describe, test} from "node:test"
import {expect} from "expect"
import {
    type SafeApplicationSettingsSnapshot,
    type SafeProjectSettingsSnapshot,
    type SafeSettingsSnapshot,
    SettingsManager,
} from "@vibefly/uiagent-shared"
import {
    applicationSnapshot,
    applySettingsFormPatch,
    diffSettingsForms,
    formFromEffective,
    mergeSettingsFormPatches,
    modelPreferencesFromApplication,
    prepareApplicationFormSave,
    prepareSettingsFormPatchSave,
    safeUiSettingsSnapshot,
} from "./hostSettings"
import {emptySettings} from "./settingsStore"

function application(
    revision: string,
    settingsJson = "{}",
    vibeflyJson = "{}",
): SafeApplicationSettingsSnapshot {
    return {
        scope: "application",
        projectRoot: null,
        settingsJson,
        vibeflyJson,
        revision,
        diagnostics: [],
    }
}

function project(vibeflyJson: string): SafeProjectSettingsSnapshot {
    return {
        scope: "project",
        projectRoot: "/workspace/project",
        settingsJson: "{}",
        vibeflyJson,
        revision: "project-1",
        diagnostics: [],
    }
}

describe("Host-backed UI settings", () => {
    test("passes through raw object documents and coerces invalid JSON", () => {
        const settings = {
            defaultProvider: "openai",
            defaultModel: "gpt",
            futureSettings: {nested: true},
            compaction: {enabled: true},
        }
        const vibefly = {
            commit: {languageMode: "zh", useCustomPrompt: false},
            modelPreferences: {pinnedModelSpecs: ["openai/gpt-5"]},
            ui: {locale: "zh"},
            futureVibefly: {flag: 1},
        }
        const snapshot = safeUiSettingsSnapshot({
            scope: "application",
            projectRoot: null,
            settingsJson: JSON.stringify(settings),
            vibeflyJson: JSON.stringify(vibefly),
            revision: "application-raw",
            diagnostics: [],
        })
        expect(JSON.parse(snapshot.settingsJson)).toEqual(settings)
        expect(JSON.parse(snapshot.vibeflyJson)).toEqual(vibefly)

        const invalid = safeUiSettingsSnapshot({
            scope: "application",
            projectRoot: null,
            settingsJson: "[1,2]",
            vibeflyJson: "not-json",
            revision: "application-invalid",
            diagnostics: [],
        })
        expect(invalid.settingsJson).toBe("{}")
        expect(invalid.vibeflyJson).toBe("{}")
    })

    test("reads pin and recent models from the application layer", async () => {
        const snapshots: Record<"application" | "project", SafeSettingsSnapshot> = {
            application: application(
                "application-1",
                "{}",
                JSON.stringify({
                    modelPreferences: {
                        pinnedModelSpecs: ["app/pinned"],
                        recentModelSpecs: ["app/recent"],
                    },
                }),
            ),
            project: project(JSON.stringify({
                modelPreferences: {
                    pinnedModelSpecs: ["project/pinned"],
                    recentModelSpecs: ["project/recent"],
                },
            })),
        }
        const manager = new SettingsManager({
            async getSettingsSnapshot(scope) {
                return snapshots[scope]
            },
        })
        await manager.initialize(true)

        expect(modelPreferencesFromApplication(applicationSnapshot(manager))).toEqual({
            pinnedModelSpecs: ["app/pinned"],
            recentModelSpecs: ["app/recent"],
        })
    })

    test("captures the raw layer and revision before a save enters the queue", async () => {
        let current = application(
            "application-1",
            JSON.stringify({defaultProvider: "old", futureSetting: true}),
            JSON.stringify({futureVibefly: true}),
        )
        const manager = new SettingsManager({
            async getSettingsSnapshot() {
                return current
            },
        })
        await manager.initialize(false)
        const form = emptySettings()
        form.providers.defaultProvider = "local"
        form.providers.defaultModel = "model"
        const prepared = prepareApplicationFormSave(manager, form)

        current = application(
            "application-2",
            JSON.stringify({defaultProvider: "external", futureSetting: false}),
            JSON.stringify({futureVibefly: false}),
        )
        await manager.handleSettingsChanged({
            scope: "application",
            projectRoot: null,
            revision: "application-2",
        })

        expect(prepared.expectedRevision).toBe("application-1")
        expect(JSON.parse(prepared.settingsJson!)).toMatchObject({
            defaultProvider: "local",
            defaultModel: "model",
            futureSetting: true,
        })
        expect(JSON.parse(prepared.vibeflyJson!)).toMatchObject({futureVibefly: true})
    })

    test("replays a local form patch over a SettingsManager revision change", async () => {
        let current = application(
            "application-1",
            JSON.stringify({
                defaultProvider: "remote-provider-1",
                defaultModel: "remote-model-1",
            }),
            JSON.stringify({
                commit: {
                    languageMode: "follow_ide",
                    useCustomPrompt: false,
                    customPrompt: "",
                },
                ui: {locale: "follow_ide"},
            }),
        )
        const manager = new SettingsManager({
            async getSettingsSnapshot() {
                return current
            },
        })
        await manager.initialize(false)

        let displayed = formFromEffective(manager.getEffectiveSettings()!)
        const localDraft = {
            ...displayed,
            providers: {...displayed.providers, defaultModel: "local-model"},
            commit: {
                ...displayed.commit,
                useCustomPrompt: true,
                customPrompt: "local prompt",
            },
        }
        let pendingPatch = mergeSettingsFormPatches(
            {},
            diffSettingsForms(displayed, localDraft),
        )
        displayed = applySettingsFormPatch(displayed, pendingPatch)

        manager.subscribe((change) => {
            displayed = applySettingsFormPatch(
                formFromEffective(change.effective),
                pendingPatch,
            )
        })
        current = application(
            "application-2",
            JSON.stringify({
                defaultProvider: "remote-provider-2",
                defaultModel: "remote-model-2",
            }),
            JSON.stringify({
                commit: {
                    languageMode: "en",
                    useCustomPrompt: false,
                    customPrompt: "remote prompt",
                },
                ui: {locale: "zh"},
            }),
        )
        await manager.handleSettingsChanged({
            scope: "application",
            projectRoot: null,
            revision: "application-2",
        })

        expect(displayed.providers).toEqual({
            defaultProvider: "remote-provider-2",
            defaultModel: "local-model",
        })
        expect(displayed.commit).toEqual({
            languageMode: "en",
            commitModelSpec: "",
            useCustomPrompt: true,
            customPrompt: "local prompt",
        })
        expect(displayed.ui.locale).toBe("zh")

        const prepared = prepareSettingsFormPatchSave(manager, pendingPatch)
        expect(prepared.expectedRevision).toBe("application-2")
        expect(JSON.parse(prepared.settingsJson!)).toEqual({
            defaultProvider: "remote-provider-2",
            defaultModel: "local-model",
        })
        expect(JSON.parse(prepared.vibeflyJson!)).toEqual({
            commit: {
                languageMode: "en",
                useCustomPrompt: true,
                customPrompt: "local prompt",
            },
            ui: {locale: "zh"},
        })

        pendingPatch = mergeSettingsFormPatches(pendingPatch, {
            commit: {customPrompt: "newer local prompt"},
        })
        expect(applySettingsFormPatch(
            formFromEffective(manager.getEffectiveSettings()!),
            pendingPatch,
        ).commit.customPrompt).toBe("newer local prompt")
    })
})
