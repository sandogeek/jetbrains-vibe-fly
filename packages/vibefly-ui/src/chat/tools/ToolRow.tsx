import {ChevronDown, FileText, Pencil, Search, Terminal, Wrench} from "lucide-react"
import {type KeyboardEvent, type MouseEvent, type ReactNode, useState} from "react"

import {useAppTranslation} from "../../i18n"
import {DiffBlock} from "./DiffBlock"
import type {ToolCard} from "./presentTool"
import {ReadBlock} from "./ReadBlock"
import {SearchBlock} from "./SearchBlock"
import {TerminalBlock} from "./TerminalBlock"
import type {ToolRowModel, ToolRowVariant} from "./toolRowModel"

/** Survives part remounts while a tool call is still streaming updates. */
const toolExpandedById = new Map<string, boolean>()

export type ToolRowProps = {
    toolCallId: string
    argsText?: string
    output?: string
    model: ToolRowModel
    card: ToolCard
    onOpenLocation: (path: string, line?: number) => void
    onToggleExpand?: () => void
}

export function ToolRow({
    toolCallId,
    argsText,
    output,
    model,
    card,
    onOpenLocation,
    onToggleExpand,
}: ToolRowProps) {
    const {t} = useAppTranslation("chat")
    const [expanded, setExpanded] = useState(() => toolExpandedById.get(toolCallId) ?? false)
    const hasCard = card.kind === "read" || card.kind === "diff" || card.kind === "terminal" || card.kind === "search"
    const expandable = hasCard || Boolean(output) || (model.state !== "running" && Boolean(argsText))
    const open = expanded && expandable
    const failureLine = model.state === "error" ? model.errorSummary : undefined
    const summaryText = failureLine ?? model.summary
    const showFileLink = model.summaryIsPath && Boolean(model.filePath) && !failureLine && Boolean(summaryText)

    const toggleExpand = () => {
        if (!expandable) return
        onToggleExpand?.()
        setExpanded((value) => {
            const next = !value
            toolExpandedById.set(toolCallId, next)
            return next
        })
    }

    const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!expandable || (event.key !== "Enter" && event.key !== " ")) return
        event.preventDefault()
        toggleExpand()
    }

    const onOpenFile = (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        if (model.filePath) onOpenLocation(model.filePath, model.line)
    }

    const onFileLinkKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation()
    }

    return (
        <div className={`tool-part${model.state === "error" ? " failed" : ""}`} data-state={model.state}>
            {model.state === "running" ? (
                <span className="tool-state-label">{t("chat:toolRunning")}</span>
            ) : model.state === "error" ? (
                <span className="tool-state-label">{t("chat:toolFailed")}</span>
            ) : null}
            <div
                className="tool-row"
                role={expandable ? "button" : undefined}
                tabIndex={expandable ? 0 : undefined}
                aria-expanded={expandable ? open : undefined}
                onClick={toggleExpand}
                onKeyDown={onRowKeyDown}
            >
                <span className="tool-leading" aria-hidden>
                    {open ? (
                        <ChevronDown size={14} className="tool-chevron" />
                    ) : (
                        <>
                            <span className="tool-icon-idle">
                                {model.state === "error" ? <span className="tool-state-dot" /> : variantIcon(model.variant)}
                            </span>
                            {expandable ? <ChevronDown size={14} className="tool-chevron-hover" /> : null}
                        </>
                    )}
                </span>
                <span className="tool-title">{t(`chat:${model.titleKey}`)}</span>
                {summaryText ? (
                    <>
                        <span className="tool-sep" aria-hidden />
                        {showFileLink ? (
                            <button
                                type="button"
                                className="tool-path"
                                title={model.filePath}
                                onClick={onOpenFile}
                                onKeyDown={onFileLinkKeyDown}
                            >
                                {summaryText}
                            </button>
                        ) : (
                            <span className={`tool-summary-text${failureLine ? " error" : ""}`} title={summaryText}>
                                {summaryText}
                            </span>
                        )}
                    </>
                ) : null}
            </div>
            {open ? (
                <div className="tool-body">
                    {card.kind === "read" ? <ReadBlock read={card.read} /> : null}
                    {card.kind === "diff" ? <DiffBlock diffs={card.diffs} /> : null}
                    {card.kind === "terminal" ? <TerminalBlock terminal={card.terminal} /> : null}
                    {card.kind === "search" ? (
                        <SearchBlock search={card.search} onOpenLocation={onOpenLocation} />
                    ) : null}
                    {card.kind === "generic" ? (
                        <div className="tool-detail">
                            {argsText ? <pre>{formatJson(argsText)}</pre> : null}
                            {output ? <pre>{output}</pre> : null}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

function variantIcon(variant: ToolRowVariant): ReactNode {
    const size = 14
    switch (variant) {
        case "read":
            return <FileText size={size} />
        case "write":
        case "edit":
            return <Pencil size={size} />
        case "bash":
            return <Terminal size={size} />
        case "search":
            return <Search size={size} />
        default:
            return <Wrench size={size} />
    }
}

function formatJson(value: string): string {
    try {
        return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
        return value
    }
}
