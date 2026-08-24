import {CheckIcon, Loader2Icon, XIcon} from "lucide-react"
import {useLayoutEffect, useRef, type ComponentProps, type ReactNode} from "react"

import {cn} from "@/lib/utils"
import {take} from "./range"
import {codeScroll, codeSurface, mono, paper} from "./surfaces"

/**
 * Official elements-terminal-block, with IDE adaptations:
 * - `lines` are React nodes so ANSI spans can render
 * - `statusLabel` / `failed` replace the hardcoded `exit 0`
 * - `headerActions` is the copy-button slot
 * - no `max-w-md` / `min-h-[8.5rem]`; body uses `codeScroll` + `max-h-56`
 * - stick-to-bottom while output grows, unless the user scrolls up
 */
export function TerminalBlock({
    command,
    lines,
    visibleCount,
    done,
    variant = "paper",
    failed = false,
    statusLabel = "exit 0",
    headerActions,
    className,
    ...props
}: Omit<
    ComponentProps<"div">,
    "children" | "command" | "lines" | "visibleCount" | "done" | "variant"
> & {
    command: string
    lines: readonly ReactNode[]
    visibleCount: number
    done: boolean
    variant?: "paper" | "ink"
    failed?: boolean
    statusLabel?: string
    headerActions?: ReactNode
}) {
    const ink = variant === "ink"
    const bodyRef = useRef<HTMLDivElement>(null)
    const stickToBottomRef = useRef(true)
    const shown = take(lines, visibleCount)

    const onScroll = () => {
        const element = bodyRef.current
        if (!element) return
        stickToBottomRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 24
    }

    useLayoutEffect(() => {
        const element = bodyRef.current
        if (!element || !stickToBottomRef.current) return
        element.scrollTop = element.scrollHeight
    }, [lines, visibleCount, done])

    return (
        <div
            data-slot="terminal-block"
            className={cn(
                ink ? "bg-foreground dark:bg-popover" : paper,
                "w-full overflow-hidden rounded-2xl font-mono text-xs",
                className,
            )}
            {...props}
        >
            <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1.5">
                <span
                    title={command}
                    className={cn(
                        "min-w-0 flex-1 truncate",
                        ink
                            ? "text-background/90 dark:text-foreground/90"
                            : "text-foreground/90",
                    )}
                >
                    {command}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                    {done ? (
                        <div className="flex items-center gap-1">
                            {failed ? (
                                <XIcon className="size-3 text-red-600 dark:text-red-400" />
                            ) : (
                                <CheckIcon className="size-3 text-emerald-500" />
                            )}
                            <span
                                className={cn(
                                    mono,
                                    failed
                                        ? "text-red-600 dark:text-red-400"
                                        : ink
                                          ? "text-background/40 dark:text-foreground/40"
                                          : "text-foreground/40",
                                )}
                            >
                                {statusLabel}
                            </span>
                        </div>
                    ) : (
                        <Loader2Icon
                            className={cn(
                                "size-3 animate-spin motion-reduce:animate-none",
                                ink
                                    ? "text-background/35 dark:text-foreground/35"
                                    : "text-foreground/35",
                            )}
                        />
                    )}
                    {headerActions}
                </div>
            </div>
            <div
                ref={bodyRef}
                onScroll={onScroll}
                className={cn(
                    codeScroll,
                    "max-h-56 overflow-y-auto",
                    ink
                        ? "text-background/55 dark:text-foreground/50"
                        : "text-foreground/50",
                )}
            >
                <div className={cn(codeSurface, "flex flex-col gap-1 px-4 pt-1 pb-3.5")}>
                    {shown.map((line, lineIndex) => {
                        const isLast = lineIndex === shown.length - 1
                        return (
                            <div
                                key={lineIndex}
                                className={cn(
                                    "fade-in animate-in fill-mode-both whitespace-pre duration-300",
                                    isLast &&
                                        (ink
                                            ? "text-background/90 dark:text-foreground/90"
                                            : "text-foreground/90"),
                                )}
                            >
                                {line}
                            </div>
                        )
                    })}
                    {!done && (
                        <span
                            aria-hidden
                            className="inline-block h-3 w-1.5 animate-pulse bg-blue-500/70 motion-reduce:animate-none dark:bg-blue-400/70"
                        />
                    )}
                </div>
            </div>
        </div>
    )
}
