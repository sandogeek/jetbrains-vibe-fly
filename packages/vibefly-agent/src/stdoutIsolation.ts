/**
 * Keep process.stdout free for SimpleRpc Content-Length frames only.
 * Redirect console methods that default to stdout onto stderr.
 *
 * Import this module first from main.ts so subsequent dependency evaluation
 * also sees the redirected console.
 */

/** Methods that Node's console routes to stdout (not stderr). */
const STDOUT_CONSOLE_METHODS = [
    "log",
    "info",
    "debug",
    "dir",
    "dirxml",
    "table",
    "time",
    "timeEnd",
    "timeLog",
    "group",
    "groupCollapsed",
    "groupEnd",
    "count",
    "countReset",
    "clear",
] as const

type StdoutConsoleMethod = (typeof STDOUT_CONSOLE_METHODS)[number]

let installed = false

/**
 * Replace stdout-bound console methods with stderr writers.
 * Safe to call multiple times (idempotent).
 */
export function redirectConsoleToStderr(): void {
    if (installed) return
    installed = true

    const toStderr = console.error.bind(console)
    const redirect =
        (...args: unknown[]): void => {
            toStderr("[vibefly-agent:stdout-redirect]", ...args)
        }

    for (const name of STDOUT_CONSOLE_METHODS) {
        const current = console[name as StdoutConsoleMethod]
        if (typeof current !== "function") continue
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;
        (console as any)[name] = redirect
    }
}

redirectConsoleToStderr()
