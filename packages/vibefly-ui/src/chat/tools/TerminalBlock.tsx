import {useCallback, useMemo, useState, type ReactNode} from "react"

import {TerminalBlock as ElementsTerminalBlock} from "../../components/elements/terminal-block"
import {useAppTranslation} from "../../i18n"
import {ansiLineIsEmpty, parseAnsiLines, type AnsiLine} from "./ansi"
import {writeClipboard} from "./clipboard"
import type {BashCardModel} from "./presentBash"

export function TerminalBlock({terminal}: {terminal: BashCardModel}) {
    const {t} = useAppTranslation("chat")
    const [copied, setCopied] = useState(false)
    const rawOutput = terminal.output ?? ""
    const ansiLines = useMemo(() => parseAnsiLines(rawOutput), [rawOutput])
    const visuallyEmpty = ansiLines.every((line) => ansiLineIsEmpty(line))
    const done = !terminal.running
    const failed = terminal.signal !== undefined || (terminal.exitCode !== undefined && terminal.exitCode !== 0)
    const lines = useMemo((): readonly ReactNode[] => {
        if (visuallyEmpty) {
            return done
                ? [<span key="empty" className="text-foreground/40">{t("chat:toolNoOutput")}</span>]
                : []
        }
        return ansiLines.map((line) => renderAnsiLine(line))
    }, [ansiLines, done, t, visuallyEmpty])
    const statusLabel = failed
        ? (terminal.signal
            ? t("chat:toolSignal", {signal: terminal.signal})
            : t("chat:toolExitCode", {code: terminal.exitCode}))
        : `exit ${terminal.exitCode ?? 0}`

    const onCopy = useCallback(() => {
        if (copied || !rawOutput) return
        void writeClipboard(rawOutput).then((ok) => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1000)
        })
    }, [copied, rawOutput])

    return (
        <ElementsTerminalBlock
            command={terminal.command}
            lines={lines}
            visibleCount={lines.length}
            done={done}
            failed={done && failed}
            statusLabel={statusLabel}
            variant="paper"
            headerActions={done && !visuallyEmpty ? (
                <button type="button" className="tool-copy" onClick={onCopy}>
                    {copied ? t("chat:toolCopied") : t("chat:toolCopy")}
                </button>
            ) : undefined}
        />
    )
}

function renderAnsiLine(line: AnsiLine): ReactNode {
    if (line.length === 0) return "\n"
    return line.map((span, index) => (
        span.style
            ? <span key={index} style={span.style}>{span.text}</span>
            : <span key={index}>{span.text}</span>
    ))
}
