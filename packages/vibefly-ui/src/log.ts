/**
 * UI logger (loglevel → console → bindConsoleToHost → Ui2Host.logFromWeb).
 * Level: localStorage.vibefly.log.level, else import.meta.env.VIBEFLY_LOG_LEVEL, else info.
 */
import log from "loglevel"

const LEVELS = ["trace", "debug", "info", "warn", "error", "silent"] as const
type LevelName = (typeof LEVELS)[number]

function normalizeLevel(raw: string | undefined | null): LevelName {
  if (!raw) return "info"
  const level = raw.toLowerCase().trim()
  if ((LEVELS as readonly string[]).includes(level)) return level as LevelName
  return "info"
}

function resolveLevel(): LevelName {
  try {
    const fromStorage = localStorage.getItem("vibefly.log.level")
    if (fromStorage) return normalizeLevel(fromStorage)
  } catch {
    // ignore (SSR / restricted storage)
  }
  const fromEnv = (
    import.meta as ImportMeta & { env?: Record<string, unknown> }
  ).env?.VIBEFLY_LOG_LEVEL
  if (typeof fromEnv === "string" && fromEnv) return normalizeLevel(fromEnv)
  return "info"
}

const originalFactory = log.methodFactory
log.methodFactory = (methodName, level, loggerName) => {
  const rawMethod = originalFactory(methodName, level, loggerName)
  return (...args: unknown[]) => {
    const tag =
      typeof loggerName === "string" && loggerName
        ? `[vibefly-ui:${loggerName}]`
        : "[vibefly-ui]"
    rawMethod(tag, ...args)
  }
}

log.setLevel(resolveLevel())

export { log }

export function getLogger(name: string): log.Logger {
  const child = log.getLogger(name)
  child.setLevel(log.getLevel())
  return child
}
