import {useCallback, useLayoutEffect, useMemo, useRef, useState} from "react"

import {useAppTranslation} from "../../i18n"
import {ansiLineIsEmpty, parseAnsiLines, type AnsiLine} from "./ansi"
import {writeClipboard} from "./clipboard"
import type {BashCardModel} from "./presentBash"
import {StateDot, type StateDotState} from "./StateDot"

export function TerminalBlock({terminal}: {terminal: BashCardModel}) {
    const {t} = useAppTranslation("chat")
    const [copied, setCopied] = useState(false)
    const bodyRef = useRef<HTMLDivElement>(null)
    const stickToBottomRef = useRef(true)
    const rawOutput = terminal.output ?? ""
    const lines = useMemo(() => parseAnsiLines(rawOutput), [rawOutput])
    const visuallyEmpty = lines.every((line) => ansiLineIsEmpty(line))
    const settled = !terminal.running
    const failed = terminal.signal !== undefined || (terminal.exitCode !== undefined && terminal.exitCode !== 0)
    const dotState: StateDotState = terminal.running ? "ongoing" : failed ? "error" : "done"
    const showCopy = settled && !visuallyEmpty
    const showPill = settled && failed

    const onCopy = useCallback(() => {
        if (copied || !rawOutput) return
        void writeClipboard(rawOutput).then((ok) => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1000)
        })
    }, [copied, rawOutput])

    const onScroll = () => {
        const element = bodyRef.current
        if (!element) return
        stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
    }

    useLayoutEffect(() => {
        const element = bodyRef.current
        if (!element || !stickToBottomRef.current) return
        element.scrollTop = element.scrollHeight
    }, [rawOutput, terminal.running])

    return (
        <div className={`terminal-block${terminal.running ? " running" : ""}`}>
            <div className="terminal-banner">
                <StateDot state={dotState} />
                <span className="terminal-prompt">$</span>
                <span className="terminal-command" title={terminal.command}>{terminal.command}</span>
                {showPill ? (
                    <span className="terminal-pill">
                        {terminal.signal
                            ? t("chat:toolSignal", {signal: terminal.signal})
                            : t("chat:toolExitCode", {code: terminal.exitCode})}
                    </span>
                ) : null}
                {showCopy ? (
                    <button type="button" className="tool-copy" onClick={onCopy}>
                        {copied ? t("chat:toolCopied") : t("chat:toolCopy")}
                    </button>
                ) : null}
            </div>
            {settled || !visuallyEmpty ? (
                <div className="terminal-body" ref={bodyRef} onScroll={onScroll}>
                    {visuallyEmpty ? (
                        <div className="terminal-empty">{t("chat:toolNoOutput")}</div>
                    ) : (
                        lines.map((line, index) => (
                            <div key={index} className="terminal-line">{renderAnsiLine(line)}</div>
                        ))
                    )}
                </div>
            ) : null}
        </div>
    )
}

function renderAnsiLine(line: AnsiLine) {
    if (line.length === 0) return "\n"
    return line.map((span, index) => (
        span.style
            ? <span key={index} style={span.style}>{span.text}</span>
            : <span key={index}>{span.text}</span>
    ))
}
