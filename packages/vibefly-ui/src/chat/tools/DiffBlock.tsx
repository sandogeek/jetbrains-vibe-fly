import {useCallback, useMemo, useState} from "react"

import {useAppTranslation} from "../../i18n"
import {writeClipboard} from "./clipboard"
import {CHAT_CARD_MAX_LINES, splitCapped} from "./contentLines"
import {buildDiffRows, diffCopyText, type DiffHunk, type DiffRowKind} from "./presentDiff"

export type DiffBlockProps = {
    diffs: DiffHunk[]
    maxLines?: number
}

const ROW_CLASS: Record<DiffRowKind, string> = {
    path: "diff-path",
    del: "diff-del",
    add: "diff-add",
    gap: "diff-gap",
}

export function DiffBlock({diffs, maxLines = CHAT_CARD_MAX_LINES}: DiffBlockProps) {
    const {t} = useAppTranslation("chat")
    const model = useMemo(() => buildDiffRows(diffs), [diffs])
    const [expanded, setExpanded] = useState(false)
    const [copied, setCopied] = useState(false)
    const {head, tail, hidden} = splitCapped(model.rows, maxLines, expanded)

    const onCopy = useCallback(() => {
        if (copied) return
        void writeClipboard(diffCopyText(model.rows)).then((ok) => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1000)
        })
    }, [copied, model.rows])

    if (model.rows.length === 0) return null

    return (
        <div className="diff-block">
            <button type="button" className="tool-copy diff-copy" onClick={onCopy}>
                {copied ? t("chat:toolCopied") : t("chat:toolCopy")}
            </button>
            <div className="diff-body">
                {head.map((row, index) => (
                    <div key={`head-${index}`} className={`diff-line ${ROW_CLASS[row.kind]}`}>{row.text}</div>
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
                {tail.map((row, index) => (
                    <div key={`tail-${index}`} className={`diff-line ${ROW_CLASS[row.kind]}`}>{row.text}</div>
                ))}
            </div>
            <div className="diff-footer">
                └ {t("chat:toolDiffFooter", {added: model.added, removed: model.removed, files: model.files})}
            </div>
        </div>
    )
}
