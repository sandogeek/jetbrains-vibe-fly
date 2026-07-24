import type { Ui2Host } from "../generated/rpc"

const METHODS = ["log", "info", "warn", "error", "debug"] as const

type ConsoleMethod = (typeof METHODS)[number]

function formatArg(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatMessage(level: ConsoleMethod, args: unknown[]): string {
  const body = args.map(formatArg).join(" ")
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
      originals[method](...args)
      if (forwarding) return
      forwarding = true
      try {
        void ui2Host.logFromWeb(formatMessage(method, args)).catch((err) => {
          if (reportedForwardError) return
          reportedForwardError = true
          const msg = err instanceof Error ? err.message : String(err)
          originals.error("logFromWeb failed:", msg)
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
