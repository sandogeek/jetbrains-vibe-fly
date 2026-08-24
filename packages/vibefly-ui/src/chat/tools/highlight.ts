import {createCssVariablesTheme, createHighlighter, type BundledLanguage, type Highlighter} from "shiki"

export type HighlightSpan = {
    text: string
    style?: {color?: string; fontStyle?: string; fontWeight?: string}
}

const cssVariablesTheme = createCssVariablesTheme({
    name: "css-variables",
    variablePrefix: "--shiki-",
    fontStyle: true,
})

const LANGUAGE_ALIASES: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    html: "html",
    css: "css",
    scss: "css",
    sh: "shellscript",
    bash: "shellscript",
    sql: "sql",
    xml: "xml",
    kt: "java",
    kts: "java",
}

const HIGHLIGHTER_LANGS = [
    "typescript",
    "tsx",
    "javascript",
    "jsx",
    "json",
    "python",
    "go",
    "rust",
    "java",
    "yaml",
    "markdown",
    "html",
    "css",
    "shellscript",
    "sql",
    "xml",
]

let highlighter: Highlighter | undefined
let generation = 0
const listeners = new Set<() => void>()

void createHighlighter({
    themes: [cssVariablesTheme],
    langs: HIGHLIGHTER_LANGS,
}).then((instance) => {
    highlighter = instance
    generation += 1
    for (const listener of listeners) listener()
}).catch(() => undefined)

export function subscribeHighlighter(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange)
    return () => {
        listeners.delete(onStoreChange)
    }
}

export function highlighterGeneration(): number {
    return generation
}

/** Tokenize a window as per-line spans. Unknown / not-yet-loaded langs return undefined. */
export function highlightLines(code: string, lang: string | undefined): HighlightSpan[][] | undefined {
    if (!highlighter || !lang) return undefined
    const resolved = LANGUAGE_ALIASES[lang] ?? lang
    if (!highlighter.getLoadedLanguages().includes(resolved)) return undefined
    const tokens = highlighter.codeToTokens(code, {lang: resolved as BundledLanguage, theme: "css-variables"})
    const lines = tokens.tokens.map((line) =>
        line.map((token) => ({
            text: token.content,
            style: token.color ? {color: token.color} : undefined,
        })),
    )
    if (lines.length > 0 && lines[lines.length - 1]?.length === 0) lines.pop()
    return lines
}
