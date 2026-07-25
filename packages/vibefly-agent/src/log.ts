/**
 * Logs must go to stderr so stdout stays SimpleRpc-only.
 * Level: VIBEFLY_LOG_LEVEL (error|warn|info|http|verbose|debug|silly), default info.
 */
import winston from "winston"

const LEVELS = [
  "error",
  "warn",
  "info",
  "http",
  "verbose",
  "debug",
  "silly",
] as const

type Level = (typeof LEVELS)[number]

function resolveLevel(): Level {
  const raw = process.env.VIBEFLY_LOG_LEVEL?.toLowerCase().trim()
  if (!raw) return "info"
  if ((LEVELS as readonly string[]).includes(raw)) return raw as Level
  process.stderr.write(
    `[vibefly-agent] WARN invalid VIBEFLY_LOG_LEVEL=${raw}, using info\n`,
  )
  return "info"
}

const META_SKIP = new Set([
  "level",
  "message",
  "timestamp",
  "module",
  "stack",
  "splat",
  "ms",
  "Symbol(level)",
  "Symbol(message)",
  "Symbol(splat)",
])

function formatMeta(meta: Record<string, unknown>): string {
  const obj: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (META_SKIP.has(k)) continue
    if (v instanceof Error) {
      obj[k] = v.stack ?? `${v.name}: ${v.message}`
    } else {
      obj[k] = v
    }
  }
  const keys = Object.keys(obj)
  if (!keys.length) return ""
  try {
    return ` ${JSON.stringify(obj)}`
  } catch {
    return ` ${String(obj)}`
  }
}

export const log = winston.createLogger({
  level: resolveLevel(),
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    winston.format.printf((info) => {
      const { level, message, timestamp, module, stack, ...rest } = info
      const prefix =
        typeof module === "string" && module
          ? `[vibefly-agent:${module}]`
          : "[vibefly-agent]"
      const lvl = String(level).toUpperCase()
      let line = `${prefix} ${timestamp} ${lvl} ${message}`
      line += formatMeta(rest as Record<string, unknown>)
      if (typeof stack === "string" && stack) {
        line += `\n${stack}`
      }
      return line
    }),
  ),
  transports: [
    new winston.transports.Console({
      // All levels → stderr so stdout remains SimpleRpc-only.
      stderrLevels: [...LEVELS],
    }),
  ],
})

export function createLogger(module: string): winston.Logger {
  return log.child({ module })
}
