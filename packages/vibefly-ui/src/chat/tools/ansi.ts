import Anser from "anser"
import type {CSSProperties} from "react"

interface AnsiChunk {
    content: string
    fg: string | null
    bg: string | null
    decorations: readonly string[]
}

export type AnsiSpan = {
    text: string
    style: CSSProperties | undefined
}

export type AnsiLine = readonly AnsiSpan[]

const TOKEN_BY_BASIC_RGB: Record<string, string> = {
    "0,0,0": "var(--vf-fg)",
    "255,255,255": "var(--vf-fg)",
    "85,85,85": "var(--vf-muted)",
    "187,0,0": "var(--vf-danger)",
    "255,85,85": "var(--vf-danger)",
    "0,187,0": "var(--vf-accent)",
    "0,255,0": "var(--vf-accent)",
    "187,187,0": "var(--vf-warning)",
    "255,255,85": "var(--vf-warning)",
    "0,0,187": "var(--vf-blue)",
    "85,85,255": "var(--vf-blue)",
}

const STYLE_BY_DECORATION: Record<string, CSSProperties | undefined> = {
    dim: {opacity: 0.7},
    italic: {fontStyle: "italic"},
    underline: {textDecoration: "underline"},
    strikethrough: {textDecoration: "line-through"},
    hidden: {visibility: "hidden"},
}

const OSC_SEQUENCE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g
const NON_CSI_ESCAPE = /\u001b(?!\[)[\u0020-\u002f]*[\u0030-\u007e]?/g
const INERT_CONTROL = /[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/g

function sanitize(text: string): string {
    return text.replace(OSC_SEQUENCE, "").replace(NON_CSI_ESCAPE, "").replace(INERT_CONTROL, "")
}

function resolveStyle(chunk: AnsiChunk): CSSProperties | undefined {
    const style: CSSProperties = {}
    const background = chunk.bg === null ? undefined : `rgb(${chunk.bg})`
    if (background !== undefined) style.backgroundColor = background
    if (chunk.fg !== null) {
        const literal = `rgb(${chunk.fg})`
        style.color = background === undefined
            ? TOKEN_BY_BASIC_RGB[chunk.fg.replace(/\s+/g, "")] ?? literal
            : literal
    }
    for (const decoration of chunk.decorations) {
        Object.assign(style, STYLE_BY_DECORATION[decoration])
    }
    return Object.keys(style).length === 0 ? undefined : style
}

/** Parse command output into styled spans grouped by line. */
export function parseAnsiLines(text: string): AnsiLine[] {
    let current: AnsiSpan[] = []
    const lines: AnsiSpan[][] = [current]
    const chunks = Anser.ansiToJson(sanitize(text), {json: true, remove_empty: true}) as AnsiChunk[]
    for (const chunk of chunks) {
        const style = resolveStyle(chunk)
        for (const [index, part] of chunk.content.split("\n").entries()) {
            if (index > 0) {
                current = []
                lines.push(current)
            }
            if (part !== "") current.push({text: part, style})
        }
    }
    return lines
}

export function ansiLineIsEmpty(line: AnsiLine): boolean {
    return line.every((span) => span.text.trim() === "")
}
