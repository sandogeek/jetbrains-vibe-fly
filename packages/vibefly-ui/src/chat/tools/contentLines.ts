/** Chat-row height cap for ReadBlock / DiffBlock, matching DeepSeek Harness. */
export const CHAT_CARD_MAX_LINES = 8
/**
 * Split a side's text into content lines. Empty text is zero lines, and a
 * single trailing newline is a terminator rather than a phantom blank line.
 */
export function contentLines(text: string): string[] {
    if (text === "") return []
    const body = text.endsWith("\n") ? text.slice(0, -1) : text
    return body.split("\n")
}
export type CappedSlices<T> = {
    head: T[]
    tail: T[]
    hidden: number
}
/** Head/tail split used when a card body exceeds the chat line cap. */
export function splitCapped<T>(items: readonly T[], maxLines: number, expanded: boolean): CappedSlices<T> {
    const hidden = items.length - maxLines
    if (hidden <= 0 || expanded) {
        return {head: [...items], tail: [], hidden: Math.max(0, hidden)}
    }
    const headCount = Math.ceil(maxLines / 2)
    const tailCount = maxLines - headCount
    return {
        head: items.slice(0, headCount),
        tail: items.slice(items.length - tailCount),
        hidden,
    }
}
