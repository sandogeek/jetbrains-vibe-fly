import {contentLines} from "./contentLines"
import {asRecord, filePathFromInput} from "./toolArgs"
export type DiffHunk = {
    path: string
    oldText: string | null
    newText: string
}
export type DiffRowKind = "path" | "del" | "add" | "gap"
export type DiffRow = {
    kind: DiffRowKind
    text: string
}
export type DiffRowsModel = {
    rows: DiffRow[]
    added: number
    removed: number
    files: number
}
type TextReplacement = {
    oldText: string
    newText: string
}
/** Write call-time diff: the whole new file, no prior content. */
export function presentWrite(input: unknown): DiffHunk[] | null {
    const filePath = filePathFromInput(input)
    const values = asRecord(input)
    if (!filePath || typeof values?.content !== "string") return null
    return [{path: filePath, oldText: null, newText: values.content}]
}
/**
 * Edit call-time diffs: each `edits[]` entry is one hunk. Legacy top-level
 * `oldText`/`newText` is treated as a single replacement.
 */
export function presentEdit(input: unknown): DiffHunk[] | null {
    const filePath = filePathFromInput(input)
    if (!filePath) return null
    const replacements = replacementsFromInput(input)
    if (!replacements) return null
    return replacements.map((replacement) => ({
        path: filePath,
        oldText: replacement.oldText,
        newText: replacement.newText,
    }))
}
/**
 * Flatten hunks into unified-diff rows. A new path opens with a header; a
 * same-file second hunk opens with `⋯`. File count is distinct paths.
 */
export function buildDiffRows(diffs: readonly DiffHunk[]): DiffRowsModel {
    const rows: DiffRow[] = []
    const paths = new Set<string>()
    let added = 0
    let removed = 0
    let previousPath: string | undefined
    for (const diff of diffs) {
        paths.add(diff.path)
        if (diff.path !== previousPath) rows.push({kind: "path", text: diff.path})
        else rows.push({kind: "gap", text: "⋯"})
        previousPath = diff.path
        if (diff.oldText !== null) {
            for (const line of contentLines(diff.oldText)) {
                rows.push({kind: "del", text: line})
                removed += 1
            }
        }
        for (const line of contentLines(diff.newText)) {
            rows.push({kind: "add", text: line})
            added += 1
        }
    }
    return {rows, added, removed, files: paths.size}
}
export function diffCopyText(rows: readonly DiffRow[]): string {
    return rows
        .map((row) => {
            switch (row.kind) {
                case "del":
                    return `- ${row.text}`
                case "add":
                    return `+ ${row.text}`
                default:
                    return row.text
            }
        })
        .join("\n")
}
function replacementsFromInput(input: unknown): TextReplacement[] | null {
    const values = asRecord(input)
    if (!values) return null
    if (Array.isArray(values.edits) && values.edits.length > 0) {
        const replacements: TextReplacement[] = []
        for (const item of values.edits) {
            const replacement = replacementFromValue(item)
            if (!replacement) return null
            replacements.push(replacement)
        }
        return replacements
    }
    const legacy = replacementFromValue(values)
    return legacy ? [legacy] : null
}
function replacementFromValue(value: unknown): TextReplacement | null {
    const record = asRecord(value)
    if (!record) return null
    if (typeof record.oldText !== "string" || typeof record.newText !== "string") return null
    return {oldText: record.oldText, newText: record.newText}
}
