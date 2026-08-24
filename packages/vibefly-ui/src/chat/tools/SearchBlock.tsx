import {useCallback, useMemo, useState} from "react"

import {useAppTranslation} from "../../i18n"
import {writeClipboard} from "./clipboard"
import {CHAT_CARD_MAX_LINES, splitCapped} from "./contentLines"
import type {SearchCardModel, SearchFileGroup} from "./presentSearch"

type SearchRow =
    | {type: "file"; path: string; count: number; index: number; collapsed: boolean}
    | {type: "match"; lineNumber: number; line: string; key: string}
    | {type: "path"; path: string}

export function SearchBlock({
    search,
    onOpenLocation,
}: {
    search: SearchCardModel
    onOpenLocation: (path: string, line?: number) => void
}) {
    const {t} = useAppTranslation("chat")
    const [expanded, setExpanded] = useState(false)
    const [copied, setCopied] = useState(false)
    const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())
    const rows = useMemo(() => flattenSearchRows(search, collapsed), [search, collapsed])
    const shown = search.kind === "paths"
        ? search.paths.length
        : search.files.reduce((sum, file) => sum + file.matches.length, 0)
    const {head, tail, hidden} = splitCapped(rows, CHAT_CARD_MAX_LINES, expanded)
    const empty = rows.length === 0

    const onCopy = useCallback(() => {
        if (copied) return
        const text = searchCopyText(search)
        if (!text) return
        void writeClipboard(text).then((ok) => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1000)
        })
    }, [copied, search])

    const toggleFile = (index: number) => {
        setCollapsed((previous) => {
            const next = new Set(previous)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
        })
    }

    const summary = search.kind === "paths"
        ? (search.truncated
            ? t("chat:toolSearchPathsCapped", {shown, total: search.total})
            : t("chat:toolSearchPaths", {shown}))
        : (search.truncated
            ? t("chat:toolSearchMatchesCapped", {shown, total: search.total, files: search.files.length})
            : t("chat:toolSearchMatches", {shown, files: search.files.length}))

    return (
        <div>
            <div className="search-block">
                <div className="search-banner">
                    <span className="search-summary">{summary}</span>
                    {!empty ? (
                        <button type="button" className="tool-copy" onClick={onCopy}>
                            {copied ? t("chat:toolCopied") : t("chat:toolCopy")}
                        </button>
                    ) : null}
                </div>
                <div className="search-body">
                    {empty ? (
                        <div className="search-empty">{t("chat:toolNoResults")}</div>
                    ) : (
                        <>
                            {head.map((row) => (
                                <SearchRowView
                                    key={searchRowKey(row)}
                                    row={row}
                                    onToggleFile={toggleFile}
                                    onOpenLocation={onOpenLocation}
                                />
                            ))}
                            {hidden > 0 ? (
                                <button
                                    type="button"
                                    className="tool-card-expand"
                                    aria-expanded={expanded}
                                    onClick={() => setExpanded((value) => !value)}
                                >
                                    {expanded ? t("chat:toolCollapse") : `… ${t("chat:toolMoreLines", {count: hidden})}`}
                                </button>
                            ) : null}
                            {tail.map((row) => (
                                <SearchRowView
                                    key={searchRowKey(row)}
                                    row={row}
                                    onToggleFile={toggleFile}
                                    onOpenLocation={onOpenLocation}
                                />
                            ))}
                        </>
                    )}
                </div>
            </div>
            {search.recovery ? <div className="search-recovery">{search.recovery}</div> : null}
        </div>
    )
}

function SearchRowView({
    row,
    onToggleFile,
    onOpenLocation,
}: {
    row: SearchRow
    onToggleFile: (index: number) => void
    onOpenLocation: (path: string, line?: number) => void
}) {
    if (row.type === "file") {
        return (
            <button
                type="button"
                className="search-file"
                onClick={() => onToggleFile(row.index)}
            >
                <span
                    className="search-file-path"
                    title={row.path}
                    onClick={(event) => {
                        event.stopPropagation()
                        onOpenLocation(row.path)
                    }}
                >
                    {row.path}
                </span>
                <span className="search-file-count">{row.count}</span>
            </button>
        )
    }
    if (row.type === "path") {
        return (
            <button
                type="button"
                className="search-path"
                title={row.path}
                onClick={() => onOpenLocation(row.path)}
            >
                {row.path}
            </button>
        )
    }
    return (
        <div className="search-match">
            <span className="search-match-gutter" aria-hidden>{row.lineNumber}</span>
            <span className="search-match-text">{row.line}</span>
        </div>
    )
}

function flattenSearchRows(search: SearchCardModel, collapsed: ReadonlySet<number>): SearchRow[] {
    if (search.kind === "paths") {
        return search.paths.map((path): SearchRow => ({type: "path", path}))
    }
    const rows: SearchRow[] = []
    search.files.forEach((file, index) => {
        const isCollapsed = collapsed.has(index)
        rows.push({type: "file", path: file.path, count: file.matches.length, index, collapsed: isCollapsed})
        if (isCollapsed) return
        for (const match of file.matches) {
            rows.push({
                type: "match",
                lineNumber: match.lineNumber,
                line: match.line,
                key: `${index}:${match.lineNumber}`,
            })
        }
    })
    return rows
}

function searchRowKey(row: SearchRow): string {
    switch (row.type) {
        case "match":
            return `match:${row.key}`
        case "file":
            return `file:${row.index}`
        case "path":
            return `path:${row.path}`
    }
}

function searchCopyText(search: SearchCardModel): string {
    if (search.kind === "paths") return search.paths.join("\n")
    return search.files
        .map((file: SearchFileGroup) => [file.path, ...file.matches.map((match) => `${match.lineNumber}: ${match.line}`)].join("\n"))
        .join("\n\n")
}
