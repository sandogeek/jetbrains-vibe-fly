import {type ToolCallMessagePartProps, useAuiState} from "@assistant-ui/react"
import {FileText, Pencil, Search, Terminal, Wrench, type LucideIcon} from "lucide-react"
import {useState, type ReactNode} from "react"

import type {ToolArtifact} from "../../chatMessageAdapter"
import {ToolTimeline} from "../../components/elements/tool-timeline"
import {useAppTranslation} from "../../i18n"
import {toolInputFromPart} from "./toolArgs"
import type {ToolRowVariant} from "./toolRowModel"
import {toolTimelineModel, type ToolTimelineCall} from "./toolTimelineModel"
import {useReleaseStickToBottom} from "./useReleaseStickToBottom"

const ICON_BY_VARIANT: Record<ToolRowVariant, LucideIcon> = {
    read: FileText,
    write: Pencil,
    edit: Pencil,
    bash: Terminal,
    search: Search,
    other: Wrench,
}

/** Survives part remounts; only stores user-initiated toggles. */
const toolTimelineOpenById = new Map<string, boolean>()

export function ToolTimelineGroup({
    part,
    children,
}: {
    children: ReactNode
    part: {indices: readonly number[]}
}) {
    const {t} = useAppTranslation("chat")
    const content = useAuiState((state) => state.message.content)
    const releaseStickToBottom = useReleaseStickToBottom()
    const toolCalls = part.indices.flatMap((index) => {
        const item = content[index]
        return item?.type === "tool-call" ? [item as ToolCallMessagePartProps] : []
    })
    const firstToolCallId = toolCalls[0]?.toolCallId
    const [userOpen, setUserOpen] = useState<boolean | null>(() =>
        firstToolCallId ? (toolTimelineOpenById.get(firstToolCallId) ?? null) : null,
    )

    if (part.indices.length <= 1) return children

    const model = toolTimelineModel(toolCalls.map(timelineCallFromPart))
    const open = userOpen ?? model.streaming
    const restingLabel = model.restingKind === "edited"
        ? t("chat:toolTimelineEdited", {count: model.restingCount})
        : t("chat:toolTimelineUsed", {count: model.restingCount})

    return (
        <ToolTimeline
            steps={model.steps.map((step) => ({
                verb: t(`chat:${step.titleKey}`),
                chip: step.chip,
                icon: ICON_BY_VARIANT[step.variant],
            }))}
            visibleSteps={model.steps.length}
            streaming={model.streaming}
            open={open}
            onOpenChange={(nextOpen) => {
                releaseStickToBottom()
                setUserOpen(nextOpen)
                if (firstToolCallId) toolTimelineOpenById.set(firstToolCallId, nextOpen)
            }}
            restingLabel={restingLabel}
            activeLabel={t("chat:toolTimelineWorking")}
            stats={model.stats}
        >
            {children}
        </ToolTimeline>
    )
}

function timelineCallFromPart(part: ToolCallMessagePartProps): ToolTimelineCall {
    const artifact = (part.artifact ?? {}) as ToolArtifact
    const status = artifact.status ?? (part.result === undefined ? "running" : "completed")
    return {
        toolName: part.toolName,
        input: toolInputFromPart(part),
        output: artifact.output,
        locations: artifact.locations,
        status,
        isError: Boolean(part.isError) || status === "failed",
    }
}
