import {buildDiffRows, presentEdit, presentWrite} from "./presentDiff"
import {fileNameFromPath} from "./toolArgs"
import {toolRowModel, type ToolRowVariant, type ToolTitleKey} from "./toolRowModel"

const TIMELINE_CHIP_MAX_LENGTH = 32

export type ToolTimelineCall = {
    toolName: string
    input: unknown
    output?: string
    locations?: {path: string; line?: number}[]
    status: "pending" | "running" | "completed" | "failed"
    isError?: boolean
}

export type ToolTimelineStepModel = {
    titleKey: ToolTitleKey
    chip: string
    variant: ToolRowVariant
}

export type ToolTimelineStat = {
    file: string
    added?: number
    removed?: number
}

export type ToolTimelineModel = {
    steps: ToolTimelineStepModel[]
    stats: ToolTimelineStat[]
    streaming: boolean
    restingKind: "edited" | "used"
    restingCount: number
}

/**
 * Collapse consecutive tool calls into the verb/chip/stat props that
 * `ToolTimeline` renders. Icons and translated verbs are applied by the group.
 */
export function toolTimelineModel(calls: readonly ToolTimelineCall[]): ToolTimelineModel {
    const steps = calls.map(timelineStepFromCall)
    const stats = timelineStatsFromCalls(calls)
    const streaming = calls.some((call) => call.status === "running" || call.status === "pending")
    const restingKind = stats.length > 0 ? "edited" : "used"
    return {
        steps,
        stats,
        streaming,
        restingKind,
        restingCount: restingKind === "edited" ? stats.length : steps.length,
    }
}

function timelineStepFromCall(call: ToolTimelineCall): ToolTimelineStepModel {
    const row = toolRowModel({
        toolName: call.toolName,
        input: call.input,
        output: call.output,
        locations: call.locations,
        status: call.status,
        isError: call.isError,
    })
    const chipSource = row.summaryIsPath && row.filePath
        ? fileNameFromPath(row.filePath)
        : row.summary
    return {
        titleKey: row.titleKey,
        chip: truncateChip(chipSource) || call.toolName,
        variant: row.variant,
    }
}

function timelineStatsFromCalls(calls: readonly ToolTimelineCall[]): ToolTimelineStat[] {
    const statsByPath = new Map<string, {added: number; removed: number}>()
    for (const call of calls) {
        const hunks = call.toolName === "write"
            ? presentWrite(call.input)
            : call.toolName === "edit"
                ? presentEdit(call.input)
                : null
        if (!hunks || hunks.length === 0) continue
        const diffRows = buildDiffRows(hunks)
        const filePath = hunks[0]?.path
        if (!filePath) continue
        const previous = statsByPath.get(filePath) ?? {added: 0, removed: 0}
        statsByPath.set(filePath, {
            added: previous.added + diffRows.added,
            removed: previous.removed + diffRows.removed,
        })
    }
    const stats: ToolTimelineStat[] = []
    for (const [filePath, counts] of statsByPath) {
        stats.push({
            file: fileNameFromPath(filePath),
            ...(counts.added > 0 ? {added: counts.added} : {}),
            ...(counts.removed > 0 ? {removed: counts.removed} : {}),
        })
    }
    return stats
}

function truncateChip(text: string): string {
    const collapsed = text.replace(/\s+/g, " ").trim()
    if (collapsed.length <= TIMELINE_CHIP_MAX_LENGTH) return collapsed
    return `${collapsed.slice(0, TIMELINE_CHIP_MAX_LENGTH - 1)}…`
}
