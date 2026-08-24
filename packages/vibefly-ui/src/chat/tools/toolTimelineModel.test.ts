import {describe, test} from "node:test"
import {expect} from "expect"
import {fileNameFromPath, toolInputFromPart} from "./toolArgs"
import {toolTimelineModel} from "./toolTimelineModel"

describe("toolTimelineModel", () => {
    test("maps read/bash/grep chips from basename, command, and pattern", () => {
        const model = toolTimelineModel([
            {
                toolName: "read",
                input: {path: "src/chat/AssistantChat.tsx"},
                status: "completed",
            },
            {
                toolName: "bash",
                input: {command: "pnpm test"},
                status: "completed",
            },
            {
                toolName: "grep",
                input: {pattern: "toolCallId"},
                status: "completed",
            },
        ])
        expect(model.streaming).toBe(false)
        expect(model.restingKind).toBe("used")
        expect(model.restingCount).toBe(3)
        expect(model.stats).toEqual([])
        expect(model.steps).toEqual([
            {titleKey: "toolRead", chip: "AssistantChat.tsx", variant: "read"},
            {titleKey: "toolBash", chip: "pnpm test", variant: "bash"},
            {titleKey: "toolGrep", chip: "toolCallId", variant: "search"},
        ])
    })

    test("truncates a long bash command chip", () => {
        const command = "pnpm exec tsc --noEmit && pnpm test --filter ui"
        const model = toolTimelineModel([
            {toolName: "bash", input: {command}, status: "completed"},
            {toolName: "ls", input: {}, status: "completed"},
        ])
        expect(model.steps[0]?.chip).toBe("pnpm exec tsc --noEmit && pnpm …")
        expect(model.steps[0]?.chip.length).toBe(32)
    })

    test("keeps two reads of the same file as separate steps", () => {
        const model = toolTimelineModel([
            {toolName: "read", input: {path: "src/a.ts"}, status: "completed"},
            {toolName: "read", input: {path: "src/a.ts"}, status: "completed"},
        ])
        expect(model.steps.map((step) => step.chip)).toEqual(["a.ts", "a.ts"])
        expect(model.restingKind).toBe("used")
        expect(model.restingCount).toBe(2)
    })

    test("aggregates write and edit stats by file", () => {
        const model = toolTimelineModel([
            {
                toolName: "write",
                input: {path: "packages/vibefly-agent/src/cancelLog.ts", content: "one\ntwo\n"},
                status: "completed",
            },
            {
                toolName: "edit",
                input: {
                    path: "packages/vibefly-agent/src/commitMessage.ts",
                    edits: [
                        {oldText: "retries: 1", newText: "retries: 3"},
                        {oldText: "hello", newText: "hello fixture"},
                    ],
                },
                status: "completed",
            },
            {
                toolName: "edit",
                input: {
                    path: "packages/vibefly-agent/src/cancelLog.ts",
                    oldText: "one",
                    newText: "one\nwarn",
                },
                status: "completed",
            },
        ])
        expect(model.streaming).toBe(false)
        expect(model.restingKind).toBe("edited")
        expect(model.restingCount).toBe(2)
        expect(model.stats).toEqual([
            {file: "cancelLog.ts", added: 4, removed: 1},
            {file: "commitMessage.ts", added: 2, removed: 2},
        ])
    })

    test("is streaming while any call is running or pending", () => {
        const model = toolTimelineModel([
            {toolName: "read", input: {path: "src/a.ts"}, status: "completed"},
            {toolName: "bash", input: {command: "pnpm test"}, status: "running"},
        ])
        expect(model.streaming).toBe(true)
        expect(model.restingKind).toBe("used")
    })

    test("uses a Windows path basename for the chip", () => {
        const model = toolTimelineModel([
            {toolName: "read", input: {path: "plugin\\src\\Main.kt"}, status: "completed"},
            {toolName: "ls", input: {}, status: "completed"},
        ])
        expect(model.steps[0]?.chip).toBe("Main.kt")
    })
})

describe("fileNameFromPath", () => {
    test("strips trailing separators", () => {
        expect(fileNameFromPath("src/chat/")).toBe("chat")
        expect(fileNameFromPath("src\\chat\\")).toBe("chat")
    })
})

describe("toolInputFromPart", () => {
    test("prefers parsed args over argsText", () => {
        expect(toolInputFromPart({
            args: {path: "a.ts"},
            argsText: "{\"path\":\"ignored.ts\"}",
        })).toEqual({path: "a.ts"})
    })
    test("parses argsText when args are empty", () => {
        expect(toolInputFromPart({
            args: {},
            argsText: "{\"command\":\"pnpm test\"}",
        })).toEqual({command: "pnpm test"})
    })
    test("returns undefined for malformed argsText", () => {
        expect(toolInputFromPart({argsText: "{not json"})).toBeUndefined()
    })
})
