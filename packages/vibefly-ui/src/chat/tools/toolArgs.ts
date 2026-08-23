/** Shared parsing of pi tool arguments for chat tool cards. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    return value as Record<string, unknown>
}
export function filePathFromInput(input: unknown): string | undefined {
    const values = asRecord(input)
    if (!values) return undefined
    for (const key of ["path", "file_path", "filePath", "file"]) {
        const candidate = values[key]
        if (typeof candidate === "string" && candidate.trim()) return candidate
    }
    return undefined
}
export function stringField(input: unknown, key: string): string | undefined {
    const values = asRecord(input)
    const candidate = values?.[key]
    return typeof candidate === "string" && candidate.trim() ? candidate : undefined
}
export function positiveInteger(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return undefined
    return value
}
export function firstOutputLine(output: string | undefined): string | undefined {
    if (!output) return undefined
    const line = output.split(/\r?\n/, 1)[0]?.trim()
    return line || undefined
}
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
    ts: "ts",
    tsx: "tsx",
    js: "js",
    jsx: "jsx",
    mjs: "js",
    cjs: "js",
    py: "py",
    rs: "rs",
    go: "go",
    kt: "kt",
    kts: "kt",
    java: "java",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "md",
    html: "html",
    css: "css",
    scss: "scss",
    sh: "sh",
    bash: "sh",
    sql: "sql",
    toml: "toml",
    xml: "xml",
    gradle: "groovy",
}
/** File-extension hint for the read banner; unknown extensions are omitted. */
export function langFromPath(filePath: string): string | undefined {
    const baseName = filePath.split(/[\\/]/).pop() ?? filePath
    const dot = baseName.lastIndexOf(".")
    if (dot <= 0 || dot === baseName.length - 1) return undefined
    return LANGUAGE_BY_EXTENSION[baseName.slice(dot + 1).toLowerCase()]
}
