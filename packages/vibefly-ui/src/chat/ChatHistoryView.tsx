import type {RecentChatSession} from "@vibefly/uiagent-shared"
import {ChevronLeft, Search} from "lucide-react"
import {useEffect, useMemo, useRef, useState} from "react"

import {useAppTranslation} from "../i18n"
import {formatRelativeTime, groupRecentSessions, type RecentSessionGroupKey} from "./recentSessions"

const GROUP_LABEL_KEY: Record<RecentSessionGroupKey, "chat:thisWeek" | "chat:thisMonth" | "chat:older"> = {
    thisWeek: "chat:thisWeek",
    thisMonth: "chat:thisMonth",
    older: "chat:older",
}

export function RecentSessionRow({
    session,
    timeLabel,
    onOpen,
}: {
    session: RecentChatSession
    timeLabel: string
    onOpen: (session: RecentChatSession) => void
}) {
    return (
        <button
            type="button"
            className="recent-session-row"
            onClick={() => onOpen(session)}
        >
            <span className="recent-session-title">{session.title}</span>
            <span className="recent-session-time">{timeLabel}</span>
        </button>
    )
}

export function ChatHistoryView({
    sessions,
    onOpen,
    onClose,
}: {
    sessions: RecentChatSession[]
    onOpen: (session: RecentChatSession) => void
    onClose: () => void
}) {
    const {t} = useAppTranslation("chat")
    const [query, setQuery] = useState("")
    const searchInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        searchInputRef.current?.focus()
    }, [])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return
            event.preventDefault()
            onClose()
        }
        document.addEventListener("keydown", onKeyDown)
        return () => document.removeEventListener("keydown", onKeyDown)
    }, [onClose])

    const filteredSessions = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (!needle) return sessions
        return sessions.filter((session) => session.title.toLowerCase().includes(needle))
    }, [query, sessions])

    const groups = useMemo(() => groupRecentSessions(filteredSessions), [filteredSessions])

    return (
        <section className="history-view">
            <div className="history-toolbar">
                <button
                    type="button"
                    className="icon-button history-back"
                    title={t("chat:backToChat")}
                    aria-label={t("chat:backToChat")}
                    onClick={onClose}
                >
                    <ChevronLeft size={18} strokeWidth={1.8}/>
                </button>
                <label className="history-search">
                    <Search size={15} strokeWidth={1.8}/>
                    <input
                        ref={searchInputRef}
                        className="history-search-input"
                        value={query}
                        placeholder={t("chat:searchSessions")}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => setQuery(event.currentTarget.value)}
                    />
                </label>
            </div>
            <div className="history-list">
                {groups.length === 0 ? (
                    <div className="history-empty">{t("chat:noRecent")}</div>
                ) : (
                    groups.map((group) => (
                        <section key={group.key} className="history-group">
                            <h2 className="history-group-title">{t(GROUP_LABEL_KEY[group.key])}</h2>
                            {group.sessions.map((session) => (
                                <RecentSessionRow
                                    key={session.sessionId}
                                    session={session}
                                    timeLabel={formatRelativeTime(session.updatedAt, t)}
                                    onOpen={onOpen}
                                />
                            ))}
                        </section>
                    ))
                )}
            </div>
        </section>
    )
}
