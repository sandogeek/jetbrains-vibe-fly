import {useCallback, useMemo, useState, useSyncExternalStore} from "react"

import {useAppTranslation} from "../../i18n"
import {writeClipboard} from "./clipboard"
import {CHAT_CARD_MAX_LINES, splitCapped} from "./contentLines"
import type {ReadCardModel} from "./presentRead"
import {highlightLines, highlighterGeneration, subscribeHighlighter} from "./highlight"

export type ReadBlockProps = {
    read: ReadCardModel
    maxLines?: number
}

export function ReadBlock({read, maxLines = CHAT_CARD_MAX_LINES}: ReadBlockProps) {
    const {t} = useAppTranslation("chat")
    const [expanded, setExpanded] = useState(false)
    const [copied, setCopied] = useState(false)
    const raw = useMemo(() => read.lines.map((line) => line.text).join("\n"), [read.lines])
    const loaded = useSyncExternalStore(subscribeHighlighter, highlighterGeneration, highlighterGeneration)
    const highlighted = useMemo(
        () => highlightLines(raw, read.lang),
        [raw, read.lang, loaded],
    )
    const windowed = read.lines.length < read.totalLines
    const {head, tail, hidden} = splitCapped(read.lines, maxLines, expanded)

    const onCopy = useCallback(() => {
        if (copied || read.lines.length === 0) return
        void writeClipboard(raw).then((ok) => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1000)
        })
    }, [copied, raw, read.lines.length])

    return (
        <div className="read-block">
            <div className="read-banner">
                <div className="read-label" title={read.path}>{read.path}</div>
                <div className="read-banner-actions">
                    {windowed ? (
                        <span className="read-count">
                            {t("chat:toolLinesShowing", {shown: read.lines.length, total: read.totalLines})}
                        </span>
                    ) : null}
                    {read.lang ? <span className="read-lang">{read.lang}</span> : null}
                    {read.lines.length > 0 ? (
                        <button type="button" className="tool-copy" onClick={onCopy}>
                            {copied ? t("chat:toolCopied") : t("chat:toolCopy")}
                        </button>
                    ) : null}
                </div>
            </div>
            <div className="read-body">
                {head.map((line, index) => renderReadLine(line, highlighted?.[index]))}
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
                {tail.map((line, index) => {
                    const lineIndex = read.lines.length - tail.length + index
                    return renderReadLine(line, highlighted?.[lineIndex])
                })}
            </div>
        </div>
    )
}

function renderReadLine(
    line: {number: number; text: string},
    spans: {text: string; style?: {color?: string}}[] | undefined,
) {
    return (
        <div key={line.number} className="read-line">
            <span className="read-gutter" aria-hidden>{line.number}</span>
            <span className="read-content">
                {spans
                    ? spans.map((span, index) => (
                        <span key={index} style={span.style}>{span.text}</span>
                    ))
                    : line.text}
            </span>
        </div>
    )
}
