import {presentBash, type BashCardModel} from "./presentBash"
import {presentEdit, presentWrite, type DiffHunk} from "./presentDiff"
import {presentRead, type ReadCardModel} from "./presentRead"
import {presentGrep, presentPaths, type SearchCardModel} from "./presentSearch"

export type ToolCard =
    | {kind: "read"; read: ReadCardModel}
    | {kind: "diff"; diffs: DiffHunk[]}
    | {kind: "terminal"; terminal: BashCardModel}
    | {kind: "search"; search: SearchCardModel}
    | {kind: "generic"}
/**
 * Choose a specialized card from the wire tool name + args/result. Malformed
 * or error calls fall through to the generic args/output dump.
 */
export function presentTool(
    toolName: string,
    input: unknown,
    output: string | undefined,
    isError: boolean,
    running = false,
): ToolCard {
    if (isError) return {kind: "generic"}
    if (toolName === "read") {
        const read = presentRead(input, output)
        if (read) return {kind: "read", read}
    }
    if (toolName === "write") {
        const diffs = presentWrite(input)
        if (diffs) return {kind: "diff", diffs}
    }
    if (toolName === "edit") {
        const diffs = presentEdit(input)
        if (diffs) return {kind: "diff", diffs}
    }
    if (toolName === "bash") {
        const terminal = presentBash(input, output, running)
        if (terminal) return {kind: "terminal", terminal}
    }
    if (toolName === "grep") {
        const search = presentGrep(output)
        if (search) return {kind: "search", search}
    }
    if (toolName === "find" || toolName === "ls") {
        const search = presentPaths(output)
        if (search) return {kind: "search", search}
    }
    return {kind: "generic"}
}
