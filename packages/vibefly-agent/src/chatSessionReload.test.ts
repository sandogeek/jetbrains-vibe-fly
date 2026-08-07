import {describe, test} from "node:test"
import {expect} from "expect"
import {refreshSessionModelFromRuntime, reloadSessionsIndependently,} from "./chatSessionRegistry.js"

describe("reloadSessionsIndependently", () => {
    test("isolates one failed session and continues reloading the others", async () => {
        const calls: string[] = []
        const completed: string[] = []
        await reloadSessionsIndependently([
            {
                sessionId: "first",
                reload: async () => {
                    calls.push("first")
                },
            },
            {
                sessionId: "broken",
                reload: async () => {
                    calls.push("broken")
                    throw new Error("reload failed")
                },
            },
            {
                sessionId: "last",
                reload: async () => {
                    calls.push("last")
                },
            },
        ], (sessionId) => completed.push(sessionId))

        expect(calls).toEqual(["first", "broken", "last"])
        expect(completed).toEqual(["first", "last"])
    })

    test("replaces the current model object from the refreshed runtime", () => {
        const previous = {
            provider: "custom",
            id: "model",
            contextWindow: 1_000,
        }
        const refreshed = {
            provider: "custom",
            id: "model",
            contextWindow: 2_000,
        }
        const state = {model: previous}
        const thinkingLevels: string[] = []

        refreshSessionModelFromRuntime({
            model: previous,
            modelRuntime: {
                getModel: () => refreshed,
            },
            state,
            thinkingLevel: "high",
            setThinkingLevel: (level: string) => {
                thinkingLevels.push(level)
            },
        } as never)

        expect(state.model).toBe(refreshed)
        expect(thinkingLevels).toEqual(["high"])
    })
})
