import {stringField} from "./toolArgs"

export type BashCardModel = {
    command: string
    output?: string
    exitCode?: number
    signal?: string
    running: boolean
}

const EMPTY_OUTPUT = "(no output)"

const STATUS_PATTERNS: Array<{kind: "exit" | "signal"; pattern: RegExp}> = [
    {kind: "exit", pattern: /(?:^|\n\n)\[exit code: (-?\d+)\]\s*$/},
    {kind: "signal", pattern: /(?:^|\n\n)\[killed by signal: ([^\]]+)\]\s*$/i},
    {kind: "exit", pattern: /(?:^|\n\n)Command exited with code (-?\d+)\s*$/},
    {kind: "signal", pattern: /(?:^|\n\n)Command killed by signal ([A-Z0-9+]+)\s*$/i},
]

/**
 * Derive a terminal card from pi `bash` args + result text. Returns null
 * when the command is missing so the generic row is the fallback.
 */
export function presentBash(
    input: unknown,
    output: string | undefined,
    running: boolean,
): BashCardModel | null {
    const command = stringField(input, "command")
    if (!command) return null
    if (output === undefined) {
        return {command, running}
    }
    const parsed = splitCommandStatus(output)
    const body = parsed.body === EMPTY_OUTPUT ? "" : parsed.body
    return {
        command,
        output: body,
        exitCode: parsed.exitCode,
        signal: parsed.signal,
        running,
    }
}

export function bashCommandFailed(card: BashCardModel): boolean {
    return card.signal !== undefined || (card.exitCode !== undefined && card.exitCode !== 0)
}

export function splitCommandStatus(output: string): {
    body: string
    exitCode?: number
    signal?: string
} {
    for (const {kind, pattern} of STATUS_PATTERNS) {
        const match = output.match(pattern)
        if (!match || match[1] === undefined) continue
        const body = output.slice(0, match.index).replace(/\n+$/, "")
        if (kind === "exit") {
            return {body, exitCode: Number(match[1])}
        }
        return {body, signal: match[1].trim()}
    }
    return {body: output}
}
