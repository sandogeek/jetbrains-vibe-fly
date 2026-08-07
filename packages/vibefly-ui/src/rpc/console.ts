import type {Ui2Host} from "../generated/rpc"

const METHODS = ["log", "info", "warn", "error", "debug"] as const

const SECRET_KEY = /(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|credential|authjson)/i
const SECRET_TEXT_PATTERNS = [
    /\bBearer\s+[^\s,;]+/gi,
    /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}/g,
] as const
const SECRET_TEXT_FIELD = /(\b(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|credential|authjson)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi
const REDACTED = "[REDACTED]"

type ConsoleMethod = (typeof METHODS)[number]

export function redactLogText(value: string): string {
    const commonSecretsRedacted = SECRET_TEXT_PATTERNS.reduce(
        (current, pattern) => current.replace(pattern, REDACTED),
        value,
    )
    return commonSecretsRedacted.replace(SECRET_TEXT_FIELD, `$1${REDACTED}`)
}

function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
    if (typeof value === "string") return redactLogText(value)
    if (value instanceof Error) {
        return redactLogText(value.stack ?? `${value.name}: ${value.message}`)
    }
    if (!value || typeof value !== "object") return value
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    if (Array.isArray(value)) {
        return value.map((entry) => redactLogValue(entry, seen))
    }
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
        output[key] = SECRET_KEY.test(key) ? REDACTED : redactLogValue(entry, seen)
    }
    return output
}

export function formatConsoleArg(value: unknown): string {
    const redacted = redactLogValue(value)
    if (typeof redacted === "string") return redacted
    try {
        return JSON.stringify(redacted)
    } catch {
        return redactLogText(String(redacted))
    }
}

export function formatConsoleMessage(level: ConsoleMethod, args: unknown[]): string {
    const body = args.map(formatConsoleArg).join(" ")
    return level === "log" ? body : `[${level}] ${body}`
}

/**
 * Forward browser console output to host via Ui2Host.logFromWeb.
 * Keeps original console behavior; returns restore function.
 *
 * Failures are reported once via the original console.error (not re-forwarded).
 */
export function bindConsoleToHost(ui2Host: Ui2Host): () => void {
    const originals = Object.fromEntries(
        METHODS.map((m) => [m, console[m].bind(console)]),
    ) as Record<ConsoleMethod, (...args: unknown[]) => void>

    let forwarding = false
    let reportedForwardError = false

    for (const method of METHODS) {
        console[method] = (...args: unknown[]) => {
            const redactedArgs = args.map((arg) => redactLogValue(arg))
            originals[method](...redactedArgs)
            if (forwarding) return
            forwarding = true
            try {
                void ui2Host.logFromWeb(formatConsoleMessage(method, redactedArgs)).catch((err) => {
                    if (reportedForwardError) return
                    reportedForwardError = true
                    const msg = err instanceof Error ? err.message : String(err)
                    originals.error("logFromWeb failed:", redactLogText(msg))
                })
            } finally {
                forwarding = false
            }
        }
    }

    return () => {
        for (const method of METHODS) {
            console[method] = originals[method]
        }
    }
}
