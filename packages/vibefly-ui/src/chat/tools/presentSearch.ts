import {contentLines} from "./contentLines"

export type SearchLineMatch = {
    lineNumber: number
    line: string
}

export type SearchFileGroup = {
    path: string
    matches: SearchLineMatch[]
}

export type SearchCardModel =
    | {
          kind: "matches"
          files: SearchFileGroup[]
          truncated: boolean
          total: number
          recovery?: string
      }
    | {
          kind: "paths"
          paths: string[]
          truncated: boolean
          total: number
          recovery?: string
      }

const EMPTY_GREP = /^No matches found\s*$/
const EMPTY_FIND = /^No files found matching pattern\s*$/
const EMPTY_LS = /^\(empty directory\)\s*$/
const MATCH_LINE = /^(.+):(\d+): (.*)$/
const CONTEXT_LINE = /^(.+)-(\d+)- (.*)$/

/** Grep result → grouped matches. Running / unparseable output returns null. */
export function presentGrep(output: string | undefined): SearchCardModel | null {
    if (output === undefined) return null
    const {body, recovery} = splitTrailingNotice(output)
    if (EMPTY_GREP.test(body.trim())) {
        return {kind: "matches", files: [], truncated: Boolean(recovery), total: 0, recovery}
    }
    const files = groupGrepMatches(body)
    if (files.length === 0) return null
    const shown = files.reduce((sum, file) => sum + file.matches.length, 0)
    return {
        kind: "matches",
        files,
        truncated: Boolean(recovery),
        total: shown,
        recovery,
    }
}

/** find / ls result → a flat path list. */
export function presentPaths(output: string | undefined): SearchCardModel | null {
    if (output === undefined) return null
    const {body, recovery} = splitTrailingNotice(output)
    const trimmed = body.trim()
    if (EMPTY_FIND.test(trimmed) || EMPTY_LS.test(trimmed) || trimmed === "") {
        return {kind: "paths", paths: [], truncated: Boolean(recovery), total: 0, recovery}
    }
    const paths = contentLines(body).map((line) => line.trim()).filter((line) => line.length > 0)
    if (paths.length === 0) return null
    return {
        kind: "paths",
        paths,
        truncated: Boolean(recovery),
        total: paths.length,
        recovery,
    }
}

export function splitTrailingNotice(output: string): {body: string; recovery?: string} {
    const match = output.match(/\n\n\[([^\]]+)\]\s*$/)
    if (!match || match.index === undefined) return {body: output}
    return {body: output.slice(0, match.index), recovery: match[1]}
}

function groupGrepMatches(body: string): SearchFileGroup[] {
    const groups: SearchFileGroup[] = []
    const byPath = new Map<string, SearchFileGroup>()
    for (const rawLine of contentLines(body)) {
        const parsed = parseGrepLine(rawLine)
        if (!parsed) continue
        let group = byPath.get(parsed.path)
        if (!group) {
            group = {path: parsed.path, matches: []}
            byPath.set(parsed.path, group)
            groups.push(group)
        }
        group.matches.push({lineNumber: parsed.lineNumber, line: parsed.line})
    }
    return groups
}

function parseGrepLine(rawLine: string): {path: string; lineNumber: number; line: string} | undefined {
    const matchLine = rawLine.match(MATCH_LINE)
    if (matchLine?.[1] && matchLine[2]) {
        return {path: matchLine[1], lineNumber: Number(matchLine[2]), line: matchLine[3] ?? ""}
    }
    const contextLine = rawLine.match(CONTEXT_LINE)
    if (contextLine?.[1] && contextLine[2]) {
        return {path: contextLine[1], lineNumber: Number(contextLine[2]), line: contextLine[3] ?? ""}
    }
    return undefined
}
