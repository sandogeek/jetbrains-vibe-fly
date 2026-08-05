/** JetBrains LAF mode mirrored onto the document (see styles.css `html[data-jb-theme]`). */
export type JbThemeMode = "dark" | "light"

export const JB_THEME_ATTR = "data-jb-theme"

export function parseJbThemeMode(mode: string): JbThemeMode | null {
    if (mode === "dark" || mode === "light") return mode
    return null
}

/** Apply IDE dark/light mode; CSS tokens live in styles.css. */
export function applyJbTheme(mode: string): void {
    const value = parseJbThemeMode(mode)
    if (!value) return
    const root = document.documentElement
    root.setAttribute(JB_THEME_ATTR, value)
    root.style.colorScheme = value
}
