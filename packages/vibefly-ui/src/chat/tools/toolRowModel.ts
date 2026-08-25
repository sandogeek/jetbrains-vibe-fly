import {filePathFromInput, fileNameFromPath, firstOutputLine, stringField} from "./toolArgs"
export type ToolRowState = "running" | "ok" | "error"
export type ToolRowVariant = "read" | "write" | "edit" | "bash" | "search" | "other"
export type ToolTitleKey =
    | "toolRead"
    | "toolWrite"
    | "toolEdit"
    | "toolBash"
    | "toolGrep"
    | "toolFind"
    | "toolLs"
    | "toolCall"
const TITLE_KEY_BY_TOOL: Record<string, ToolTitleKey> = {
    read: "toolRead",
    write: "toolWrite",
    edit: "toolEdit",
    bash: "toolBash",
    grep: "toolGrep",
    find: "toolFind",
    ls: "toolLs",
}
export type ToolRowModel = {
    variant: ToolRowVariant
    titleKey: ToolTitleKey
    filePath?: string
    line?: number
    summary: string
    errorSummary?: string
    state: ToolRowState
    summaryIsPath: boolean
}
export function classifyTool(toolName: string): ToolRowVariant {
    switch (toolName) {
        case "read":
            return "read"
        case "write":
            return "write"
        case "edit":
            return "edit"
        case "bash":
            return "bash"
        case "grep":
        case "find":
        case "ls":
            return "search"
        default:
            return "other"
    }
}
export function toolRowModel(options: {
    toolName: string
    input: unknown
    output?: string
    locations?: {path: string; line?: number}[]
    status: "pending" | "running" | "completed" | "failed"
    isError?: boolean
    commandFailed?: boolean
}): ToolRowModel {
    const variant = classifyTool(options.toolName)
    const state: ToolRowState =
        options.isError || options.status === "failed" || options.commandFailed
            ? "error"
            : options.status === "running" || options.status === "pending"
              ? "running"
              : "ok"
    const filePath = filePathFromInput(options.input) ?? options.locations?.[0]?.path
    const line = options.locations?.[0]?.line
    const command = variant === "bash" ? stringField(options.input, "command") : undefined
    const pattern = options.toolName === "grep" || options.toolName === "find"
        ? stringField(options.input, "pattern")
        : undefined
    const errorSummary = state === "error" ? firstOutputLine(options.output) : undefined
    // Read rows show only the file name; the full path stays on the link
    // target and tooltip.
    const pathSummary = variant === "read" && filePath ? fileNameFromPath(filePath) : filePath
    const summary = errorSummary ?? command ?? pattern ?? pathSummary ?? (options.toolName === "ls" ? "." : "")
    const summaryIsPath =
        !errorSummary
        && !command
        && !pattern
        && Boolean(filePath || options.toolName === "ls")
    return {
        variant,
        titleKey: TITLE_KEY_BY_TOOL[options.toolName] ?? "toolCall",
        filePath,
        line,
        summary,
        errorSummary,
        state,
        summaryIsPath,
    }
}
