export function now(): number {
  return Date.now()
}

export function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function firstLine(value: string, fallback = "New session"): string {
  const title = value.split(/\r?\n/, 1)[0]?.trim().replace(/[\x00-\x1f\x7f]/g, "")
  if (!title) return fallback
  return title.length > 72 ? `${title.slice(0, 69)}...` : title
}

export function safeJson(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return ""
      const item = part as Record<string, unknown>
      if (item.type === "text") return typeof item.text === "string" ? item.text : ""
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

/**
 * Flatten a pi tool result into the string the UI cards render.
 * Structured `{ content, details }` payloads must not be JSON-dumped.
 */
export function toolResultText(result: unknown): string {
  if (typeof result === "string") return result
  if (result && typeof result === "object") {
    if ("content" in result) {
      const content = (result as {content: unknown}).content
      if (typeof content === "string") return content
      if (Array.isArray(content)) return textFromContent(content)
    }
    if (Array.isArray(result)) return textFromContent(result)
  }
  return safeJson(result)
}
