import * as fs from "node:fs"
import * as path from "node:path"
import type {ExtensionFactory} from "@earendil-works/pi-coding-agent"
import type {
  Agent2Ui,
  ChatFileLocation,
  ToolPermissionDecision,
} from "@vibefly/uiagent-shared"
import {errorMessage, makeId} from "./util.js"

type ToolPermissionRequest = Parameters<Agent2Ui["requestToolPermission"]>[0]

const FILE_TOOLS = new Set(["read", "grep", "glob", "ast_grep", "edit", "write"])

export function pathInsideProject(projectRoot: string, candidate: string): string {
  const normalizedRoot = fs.realpathSync(projectRoot)
  if (!candidate.trim() || path.isAbsolute(candidate)) {
    throw new Error(`Context path must be project-relative: ${candidate}`)
  }
  const absolute = path.resolve(normalizedRoot, candidate)
  const relative = path.relative(normalizedRoot, absolute)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Context path escapes the project: ${candidate}`)
  }
  let existing = absolute
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) {
    existing = path.dirname(existing)
  }
  if (fs.existsSync(existing)) {
    const realExisting = fs.realpathSync(existing)
    const unresolvedSuffix = path.relative(existing, absolute)
    const real = path.resolve(realExisting, unresolvedSuffix)
    const realRelative = path.relative(normalizedRoot, real)
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error(`Context path resolves outside the project: ${candidate}`)
    }
  }
  return absolute
}

export function locationsFromArgs(args: unknown, projectRoot: string): ChatFileLocation[] | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined
  const values = args as Record<string, unknown>
  const candidates = [values.path, values.file, values.filePath]
  const locations: ChatFileLocation[] = []
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue
    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(projectRoot, candidate)
    const relative = path.relative(projectRoot, absolute)
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      locations.push({path: relative || path.basename(absolute)})
    }
  }
  return locations.length > 0 ? locations : undefined
}

function pathCandidates(toolName: string, input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return []
  const values = input as Record<string, unknown>
  const candidates: string[] = []
  for (const key of [
    "path",
    "file",
    "filePath",
    "file_path",
    "paths",
    "files",
    "rename",
    "destination",
    "newPath",
  ]) {
    const value = values[key]
    if (typeof value === "string") candidates.push(...value.split(";"))
    if (Array.isArray(value)) candidates.push(...value.filter((item): item is string => typeof item === "string"))
  }
  if (toolName === "edit") {
    const edits = Array.isArray(values.edits) ? values.edits : []
    for (const edit of edits) {
      if (!edit || typeof edit !== "object" || Array.isArray(edit)) continue
      const rename = (edit as Record<string, unknown>).rename
      if (typeof rename === "string") candidates.push(rename)
    }
    if (typeof values.input === "string") {
      for (const match of values.input.matchAll(/^\[([^#\r\n]+)(?:#[0-9a-fA-F]{4})?]/gm)) {
        if (match[1]) candidates.push(match[1])
      }
      for (const match of values.input.matchAll(/^\*\*\* (?:Add|Update|Delete|Move to) File:\s*(.+)$/gm)) {
        if (match[1]) candidates.push(match[1])
      }
      for (const match of values.input.matchAll(/^\*\*\* Move to:\s*(.+)$/gm)) {
        if (match[1]) candidates.push(match[1])
      }
    }
  }
  return candidates
    .flatMap((value) => value.split(";"))
    .map((value) => value.trim())
    .filter(Boolean)
}

export function validateToolPaths(projectRoot: string, toolName: string, input: unknown): void {
  for (const candidate of pathCandidates(toolName, input)) {
    if (/^(?:https?|memory|skill):\/\//i.test(candidate)) continue
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
      throw new Error(`File URI is outside the project workspace: ${candidate}`)
    }
    pathInsideProject(projectRoot, candidate)
  }
}

export function createPathGuardExtension(
  projectRoot: string,
  requestPermission: (request: ToolPermissionRequest) => Promise<ToolPermissionDecision>,
): ExtensionFactory {
  return (api) => {
    api.on("tool_call", async (event, context) => {
      if (FILE_TOOLS.has(event.toolName)) {
        try {
          validateToolPaths(projectRoot, event.toolName, event.input)
        } catch (error) {
          return {block: true, reason: errorMessage(error)}
        }
      }
      if (event.toolName !== "bash" && event.toolName !== "edit" && event.toolName !== "write") {
        return undefined
      }
      if (!context.hasUI) {
        return {block: true, reason: "Tool requires approval, but no UI is available"}
      }
      const command = event.toolName === "bash"
        ? String((event.input as Record<string, unknown>).command ?? "")
        : undefined
      const locations = locationsFromArgs(event.input, projectRoot)
      const title = event.toolName === "bash"
        ? `Run ${command}`
        : event.toolName === "edit"
          ? `Edit ${locations?.map((location) => location.path).join(", ") || "project files"}`
          : `Write ${locations?.map((location) => location.path).join(", ") || "project files"}`
      const decision = await requestPermission({
        requestId: makeId("permission"),
        sessionId: context.sessionManager.getSessionId(),
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        title,
        command,
        cwd: projectRoot,
        input: event.input,
        locations,
      })
      if (decision === "allow_once" || decision === "allow_always") return undefined
      return {block: true, reason: decision === "cancelled" ? "Cancelled by user" : "Blocked by user"}
    })
  }
}
