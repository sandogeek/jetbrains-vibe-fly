import type {RecentChatSession} from "@vibefly/uiagent-shared"

import type {Translator} from "../i18n"

export const RECENT_PREVIEW_LIMIT = 3

export type RelativeTimeParts =
    | {unit: "justNow"}
    | {unit: "minutes"; count: number}
    | {unit: "hours"; count: number}
    | {unit: "days"; count: number}

export type RecentSessionGroupKey = "thisWeek" | "thisMonth" | "older"

export type RecentSessionGroup = {
    key: RecentSessionGroupKey
    sessions: RecentChatSession[]
}

const MILLISECONDS_PER_MINUTE = 60_000
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR
const RECENT_GROUP_ORDER: RecentSessionGroupKey[] = ["thisWeek", "thisMonth", "older"]

export function relativeTimeParts(updatedAt: number, now: number = Date.now()): RelativeTimeParts {
    const elapsedMs = Math.max(0, now - updatedAt)
    if (elapsedMs < MILLISECONDS_PER_MINUTE) return {unit: "justNow"}
    if (elapsedMs < MILLISECONDS_PER_HOUR) {
        return {unit: "minutes", count: Math.floor(elapsedMs / MILLISECONDS_PER_MINUTE)}
    }
    if (elapsedMs < MILLISECONDS_PER_DAY) {
        return {unit: "hours", count: Math.floor(elapsedMs / MILLISECONDS_PER_HOUR)}
    }
    return {unit: "days", count: Math.floor(elapsedMs / MILLISECONDS_PER_DAY)}
}

export function formatRelativeTime(
    updatedAt: number,
    translate: Translator,
    now: number = Date.now(),
): string {
    const parts = relativeTimeParts(updatedAt, now)
    if (parts.unit === "justNow") return translate("chat:timeJustNow")
    if (parts.unit === "minutes") return translate("chat:timeMinutesAgo", {amount: parts.count})
    if (parts.unit === "hours") return translate("chat:timeHoursAgo", {amount: parts.count})
    return translate("chat:timeDaysAgo", {amount: parts.count})
}

export function startOfLocalWeek(now: Date): Date {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekday = start.getDay()
    const daysFromMonday = weekday === 0 ? 6 : weekday - 1
    start.setDate(start.getDate() - daysFromMonday)
    return start
}

export function recentSessionGroupKey(updatedAt: number, now: Date): RecentSessionGroupKey {
    if (updatedAt >= startOfLocalWeek(now).getTime()) return "thisWeek"
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    if (updatedAt >= monthStart) return "thisMonth"
    return "older"
}

export function filterListedRecentSessions(
    sessions: RecentChatSession[],
    currentSessionId: string,
): RecentChatSession[] {
    return sessions.filter(
        (session) => session.sessionId !== currentSessionId && session.messageCount > 0,
    )
}

export function groupRecentSessions(
    sessions: RecentChatSession[],
    now: Date = new Date(),
): RecentSessionGroup[] {
    const grouped = new Map<RecentSessionGroupKey, RecentChatSession[]>()
    for (const key of RECENT_GROUP_ORDER) grouped.set(key, [])
    for (const session of sessions) {
        grouped.get(recentSessionGroupKey(session.updatedAt, now))!.push(session)
    }
    return RECENT_GROUP_ORDER
        .map((key) => ({key, sessions: grouped.get(key) ?? []}))
        .filter((group) => group.sessions.length > 0)
}
