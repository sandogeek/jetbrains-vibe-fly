import {useCallback, useMemo, useState} from "react"

import {useAppTranslation} from "../../i18n"
import {writeClipboard} from "./clipboard"
import {CHAT_CARD_MAX_LINES, splitCapped} from "./contentLines"
import type {ReadCardModel} from "./presentRead"

export type ReadBlockProps = {
    read: ReadCardModel
    maxLines?: number
}

export function ReadBlock({read, maxLines = CHAT_CARD_MAX_LINES}: ReadBlockProps) {
    const {t} = useAppTranslation("chat")
    const [expanded, setExpanded] = useState(false)
    const [copied, setCopied] = useState(false)
    const raw = useMemo(() => read.lines.map((line) => line.text).join("\n"), [read.lines])
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
                {head.map((line) => (
                    <div key={line.number} className="read-line">
                        <span className="read-gutter" aria-hidden>{line.number}</span>
                        <span className="read-content">{line.text}</span>
                    </div>
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
                {tail.map((line) => (
                    <div key={line.number} className="read-line">
                        <span className="read-gutter" aria-hidden>{line.number}</span>
                        <span className="read-content">{line.text}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}
