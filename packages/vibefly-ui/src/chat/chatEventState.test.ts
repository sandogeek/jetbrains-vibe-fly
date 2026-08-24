import {describe, test} from "node:test"
import {expect} from "expect"
import type {ChatMessage, ChatSessionSnapshot, ChatSessionSummary} from "@vibefly/uiagent-shared"
import {applyChatEvent} from "./chatEventState"

function summary(sessionId: string, overrides: Partial<ChatSessionSummary> = {}): ChatSessionSummary {
    return {
        sessionId,
        title: sessionId,
        state: "idle",
        unread: false,
        updatedAt: 1,
        messageCount: 0,
        ...overrides,
    }
}

function tab(sessionId: string, messages: ChatMessage[] = []): ChatSessionSnapshot {
    return {summary: summary(sessionId, {messageCount: messages.length}), messages}
}

describe("applyChatEvent", () => {
    test("appends new snapshots and replaces existing sessions in place", () => {
        const initial = [tab("one")]
        const appended = applyChatEvent(
            initial,
            {kind: "snapshot", snapshot: tab("two")},
            "one",
        ).tabs
        const replacement = tab("one", [
            {
                id: "user-1",
                role: "user",
                status: "complete",
                createdAt: 2,
                parts: [{kind: "text", text: "hello"}],
            },
        ])

        const replaced = applyChatEvent(
            appended,
            {kind: "snapshot", snapshot: replacement},
            "one",
        ).tabs

        expect(replaced.map((item) => item.summary.sessionId)).toEqual(["one", "two"])
        expect(replaced[0]).toBe(replacement)
    })

    test("merges summaries and suppresses unread state for the active session", () => {
        const active = applyChatEvent(
            [tab("one")],
            {kind: "summary", summary: summary("one", {state: "running", unread: true})},
            "one",
        ).tabs[0]!
        const background = applyChatEvent(
            [tab("one")],
            {kind: "summary", summary: summary("one", {state: "running", unread: true})},
            "two",
        ).tabs[0]!

        expect(active.summary).toMatchObject({state: "running", unread: false})
        expect(background.summary).toMatchObject({state: "running", unread: true})
    })

    test("upserts messages and applies text deltas and terminal status", () => {
        const message: ChatMessage = {
            id: "assistant-1",
            role: "assistant",
            status: "streaming",
            createdAt: 2,
            parts: [{kind: "text", text: "Hel"}],
        }
        let tabs = applyChatEvent(
            [tab("one")],
            {kind: "message", sessionId: "one", message},
            "one",
        ).tabs
        tabs = applyChatEvent(
            tabs,
            {
                kind: "partDelta",
                sessionId: "one",
                messageId: message.id,
                partKind: "text",
                delta: "lo",
            },
            "one",
        ).tabs
        tabs = applyChatEvent(
            tabs,
            {
                kind: "messageStatus",
                sessionId: "one",
                messageId: message.id,
                status: "complete",
            },
            "one",
        ).tabs

        expect(tabs[0]!.messages[0]).toMatchObject({
            id: message.id,
            status: "complete",
            parts: [{kind: "text", text: "Hello"}],
        })

        const replacement = {...message, status: "error" as const}
        const replaced = applyChatEvent(
            tabs,
            {kind: "message", sessionId: "one", message: replacement},
            "one",
        ).tabs
        expect(replaced[0]!.messages).toEqual([replacement])
    })

    test("creates missing streaming messages and merges tool updates", () => {
        let result = applyChatEvent(
            [tab("one")],
            {
                kind: "partDelta",
                sessionId: "one",
                messageId: "assistant-1",
                partKind: "thinking",
                delta: "Inspecting",
            },
            "one",
        )
        result = applyChatEvent(
            result.tabs,
            {
                kind: "tool",
                sessionId: "one",
                messageId: "assistant-1",
                part: {
                    kind: "tool",
                    toolCallId: "tool-1",
                    name: "edit",
                    status: "running",
                    input: {path: "src/App.tsx"},
                },
            },
            "one",
        )
        result = applyChatEvent(
            result.tabs,
            {
                kind: "tool",
                sessionId: "one",
                messageId: "assistant-1",
                part: {
                    kind: "tool",
                    toolCallId: "tool-1",
                    name: "edit",
                    status: "completed",
                    output: "+2 -1",
                    locations: [{path: "src/App.tsx"}],
                },
            },
            "one",
        )

        expect(result.tabs[0]!.messages[0]).toMatchObject({
            role: "assistant",
            status: "streaming",
            parts: [
                {kind: "thinking", text: "Inspecting"},
                {kind: "tool", toolCallId: "tool-1", status: "completed", output: "+2 -1"},
            ],
        })
        expect(result.effects.refreshPaths).toEqual(["src/App.tsx"])
    })

    test("bash updates replace output without dropping start-time input", () => {
        let result = applyChatEvent(
            [tab("one")],
            {
                kind: "tool",
                sessionId: "one",
                messageId: "assistant-1",
                part: {
                    kind: "tool",
                    toolCallId: "bash-1",
                    name: "bash",
                    status: "running",
                    input: {command: "pnpm test"},
                },
            },
            "one",
        )
        result = applyChatEvent(
            result.tabs,
            {
                kind: "tool",
                sessionId: "one",
                messageId: "assistant-1",
                part: {
                    kind: "tool",
                    toolCallId: "bash-1",
                    name: "bash",
                    status: "running",
                    output: "ok 1",
                },
            },
            "one",
        )
        const tool = result.tabs[0]!.messages[0]!.parts.find((part) => part.kind === "tool")
        expect(tool).toMatchObject({
            status: "running",
            output: "ok 1",
            input: {command: "pnpm test"},
        })
    })

    test("applies turn completion, release, and disconnected effects", () => {
        const completed = applyChatEvent(
            [tab("one"), tab("two")],
            {
                kind: "turnComplete",
                sessionId: "two",
                turnId: "turn-1",
                ok: false,
                error: "failed",
            },
            "one",
        )

        expect(completed.tabs[1]!.summary).toMatchObject({state: "error", unread: true})
        expect(completed.effects.error).toBe("failed")

        const aborted = applyChatEvent(
            completed.tabs,
            {
                kind: "turnComplete",
                sessionId: "two",
                turnId: "turn-1",
                ok: false,
                aborted: true,
                error: "cancelled",
            },
            "two",
        )
        expect(aborted.tabs[1]!.summary).toMatchObject({state: "idle", unread: false})
        expect(aborted.effects.error).toBeUndefined()

        const released = applyChatEvent(
            aborted.tabs,
            {kind: "sessionReleased", sessionId: "two"},
            "one",
        )
        expect(released.tabs.map((item) => item.summary.sessionId)).toEqual(["one"])

        const disconnected = applyChatEvent(
            released.tabs,
            {kind: "disconnected", message: "connection lost"},
            "one",
        )
        expect(disconnected.tabs).toBe(released.tabs)
        expect(disconnected.effects.error).toBe("connection lost")
    })
})
