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
    test("projects only browser-safe settings fields", () => {
        const snapshot = safeUiSettingsSnapshot({
            scope: "application",
            projectRoot: null,
            settingsJson: JSON.stringify({
                defaultProvider: "openai",
                defaultModel: {token: "invalid-model-secret"},
                httpProxy: "https://proxy-user:proxy-password@example.com?token=proxy-secret",
                apiKey: "unknown-api-key-secret",
                futureSettings: {token: "unknown-nested-secret"},
            }),
            vibeflyJson: JSON.stringify({
                commit: {
                    languageMode: "zh",
                    useCustomPrompt: false,
                    unknownCredential: "unknown-commit-secret",
                },
                modelPreferences: {
                    pinnedModelSpecs: ["openai/gpt-5"],
                    recentModelSpecs: [{token: "invalid-array-secret"}],
                    unknownToken: "unknown-preference-secret",
                },
                ui: {
                    locale: "zh",
                    futureSecret: "unknown-ui-secret",
                },
                auth: {token: "unknown-vibefly-secret"},
            }),
            revision: "application-safe",
            diagnostics: [],
        })

        expect(JSON.parse(snapshot.settingsJson)).toEqual({
            defaultProvider: "openai",
        })
        expect(JSON.parse(snapshot.vibeflyJson)).toEqual({
            commit: {
                languageMode: "zh",
                useCustomPrompt: false,
            },
            modelPreferences: {
                pinnedModelSpecs: ["openai/gpt-5"],
            },
            ui: {locale: "zh"},
        })
        const serialized = JSON.stringify(snapshot)
        expect(serialized).not.toContain("httpProxy")
        expect(serialized).not.toContain("proxy-password")
        expect(serialized).not.toContain("proxy-secret")
        expect(serialized).not.toContain("unknown-api-key-secret")
        expect(serialized).not.toContain("unknown-nested-secret")
        expect(serialized).not.toContain("unknown-commit-secret")
        expect(serialized).not.toContain("unknown-preference-secret")
        expect(serialized).not.toContain("unknown-ui-secret")
        expect(serialized).not.toContain("unknown-vibefly-secret")
        expect(serialized).not.toContain("invalid-model-secret")
        expect(serialized).not.toContain("invalid-array-secret")
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
