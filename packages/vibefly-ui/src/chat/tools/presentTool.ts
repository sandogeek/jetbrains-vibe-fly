import {presentEdit, presentWrite, type DiffHunk} from "./presentDiff"
import {presentRead, type ReadCardModel} from "./presentRead"
export type ToolCard =
    | {kind: "read"; read: ReadCardModel}
    | {kind: "diff"; diffs: DiffHunk[]}
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
    return {kind: "generic"}
}
