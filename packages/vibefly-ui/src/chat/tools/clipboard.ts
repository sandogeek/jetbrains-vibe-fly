export function writeClipboard(text: string): Promise<boolean> {
    if (!text) return Promise.resolve(false)
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text).then(() => true).catch(() => false)
    }
    return Promise.resolve(false)
}
