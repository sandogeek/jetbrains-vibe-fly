import {describe, test} from "node:test"
import {expect} from "expect"
import type {RecentChatSession} from "@vibefly/uiagent-shared"

import {
    filterListedRecentSessions,
    groupRecentSessions,
    recentSessionGroupKey,
    relativeTimeParts,
    startOfLocalWeek,
} from "./recentSessions"

function recentSession(
    sessionId: string,
    overrides: Partial<RecentChatSession> = {},
): RecentChatSession {
    return {
        sessionId,
        title: sessionId,
        sessionFile: `${sessionId}.jsonl`,
        updatedAt: 1,
        messageCount: 2,
        ...overrides,
    }
}

describe("relativeTimeParts", () => {
    const now = Date.parse("2026-08-19T15:00:00")

    test("uses just now under one minute", () => {
        expect(relativeTimeParts(now - 10_000, now)).toEqual({unit: "justNow"})
        expect(relativeTimeParts(now, now)).toEqual({unit: "justNow"})
    })

    test("uses minutes, hours, then days", () => {
        expect(relativeTimeParts(now - 5 * 60_000, now)).toEqual({unit: "minutes", count: 5})
        expect(relativeTimeParts(now - 3 * 60 * 60_000, now)).toEqual({unit: "hours", count: 3})
        expect(relativeTimeParts(now - 6 * 24 * 60 * 60_000, now)).toEqual({unit: "days", count: 6})
    })
})

describe("recent session grouping", () => {
    // Wednesday 19 Aug 2026 — week starts Monday 17 Aug.
    const now = new Date(2026, 7, 19, 15, 0, 0)

    test("starts the local week on Monday", () => {
        const weekStart = startOfLocalWeek(now)
        expect(weekStart.getFullYear()).toBe(2026)
        expect(weekStart.getMonth()).toBe(7)
        expect(weekStart.getDate()).toBe(17)
        expect(weekStart.getHours()).toBe(0)
    })

    test("classifies this week, this month, and older", () => {
        expect(recentSessionGroupKey(new Date(2026, 7, 18, 12).getTime(), now)).toBe("thisWeek")
        expect(recentSessionGroupKey(new Date(2026, 7, 10, 9).getTime(), now)).toBe("thisMonth")
        expect(recentSessionGroupKey(new Date(2026, 6, 30, 9).getTime(), now)).toBe("older")
    })

    test("groups in week / month / older order and drops empty buckets", () => {
        const sessions = [
            recentSession("week", {updatedAt: new Date(2026, 7, 18).getTime()}),
            recentSession("month", {updatedAt: new Date(2026, 7, 8).getTime()}),
            recentSession("older", {updatedAt: new Date(2026, 5, 1).getTime()}),
        ]
        expect(groupRecentSessions(sessions, now)).toEqual([
            {key: "thisWeek", sessions: [sessions[0]]},
            {key: "thisMonth", sessions: [sessions[1]]},
            {key: "older", sessions: [sessions[2]]},
        ])
        expect(groupRecentSessions([sessions[2]!], now)).toEqual([
            {key: "older", sessions: [sessions[2]]},
        ])
    })
})

describe("filterListedRecentSessions", () => {
    test("drops the current blank session and empty files", () => {
        const listed = filterListedRecentSessions(
            [
                recentSession("current", {messageCount: 4}),
                recentSession("empty", {messageCount: 0}),
                recentSession("kept", {messageCount: 3}),
            ],
            "current",
        )
        expect(listed.map((session) => session.sessionId)).toEqual(["kept"])
    })
})

