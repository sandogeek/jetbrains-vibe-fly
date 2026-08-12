import * as fs from "node:fs"
import * as path from "node:path"
import type {ChatContextItem} from "@vibefly/uiagent-shared"
import {log} from "../log.js"
import {pathInsideProject} from "./toolPathGuard.js"

export {firstLine, makeId, now, errorMessage} from "./util.js"

export function normalizeProjectRoot(projectRoot: string): string {
  const resolved = path.resolve(projectRoot.trim())
  if (!path.isAbsolute(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Invalid project root: ${projectRoot}`)
  }
  return fs.realpathSync(resolved)
}

/**
 * Per-project session directory under agentDir/sessions.
 * Envelope `--<sanitized-root>--` (slashes/colons → `-`) keeps path separators
 * out of the folder name while remaining unique per absolute root.
 */
export function sessionDirFor(projectRoot: string, agentDir: string): string {
  const resolvedRoot = path.resolve(projectRoot)
  const safePath = `--${resolvedRoot.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`
  const sessionDir = path.join(agentDir, "sessions", safePath)
  fs.mkdirSync(sessionDir, {recursive: true, mode: 0o700})
  return sessionDir
}

export function formatPrompt(text: string, contexts: ChatContextItem[], projectRoot: string): string {
  if (contexts.length === 0) return text
  const blocks = contexts.map((context) => {
    pathInsideProject(projectRoot, context.path)
    if (context.kind === "selection") {
      const selection = (context.text ?? "").slice(0, 256 * 1024)
      const lines = context.startLine
        ? ` lines ${context.startLine}${context.endLine && context.endLine !== context.startLine ? `-${context.endLine}` : ""}`
        : ""
      return `<selection path="${context.path}"${lines}>\n${selection}\n</selection>`
    }
    return `<file path="${context.path}" />`
  })
  return `${text}\n\n<context>\n${blocks.join("\n")}\n</context>`
}

export async function reloadSessionsIndependently(
  sessions: Iterable<{sessionId: string; reload: () => Promise<void>}>,
  onReloaded: (sessionId: string) => void = () => {},
): Promise<void> {
  for (const session of sessions) {
    try {
      await session.reload()
      onReloaded(session.sessionId)
    } catch (error) {
      log.warn("chat session reload failed", {
        sessionId: session.sessionId,
        err: error,
      })
    }
  }
}
