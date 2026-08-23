import {contentLines} from "./contentLines"
import {asRecord, filePathFromInput, langFromPath, positiveInteger} from "./toolArgs"
export type ReadLine = {
    number: number
    text: string
}
export type ReadCardModel = {
    path: string
    offset: number
    lines: ReadLine[]
    totalLines: number
    lang?: string
}
/**
 * Derive a read card from pi `read` args + result text. Returns null while
 * running (no output yet) or when args are malformed — the generic row is
 * the fallback.
 *
 * Line numbers start at `offset` (default 1). `totalLines` is the window
 * length: the wire does not carry the whole-file count, so the banner never
 * pretends to know "N of M" unless a later producer fills a larger total.
 */
export function presentRead(input: unknown, output: string | undefined): ReadCardModel | null {
    const filePath = filePathFromInput(input)
    if (!filePath) return null
    if (output === undefined) return null
    const values = asRecord(input)
    const offset = positiveInteger(values?.offset) ?? 1
    const lines = contentLines(output).map((text, index) => ({
        number: offset + index,
        text,
    }))
    return {
        path: filePath,
        offset,
        lines,
        totalLines: lines.length,
        lang: langFromPath(filePath),
    }
}
