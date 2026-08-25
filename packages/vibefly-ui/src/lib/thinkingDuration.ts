/** Minimum thinking duration that is worth showing, in milliseconds. */
export const MIN_DISPLAYED_THINKING_MS = 100

/**
 * Format a thinking duration (ms) as seconds for the reasoning trigger.
 * Durations below 0.1s return `undefined` (nothing shown); anything else is
 * floored to a 0.1s step and clamped so at least "0.1" is displayed.
 */
export function formatThinkingSeconds(durationMs: number): string | undefined {
    if (!Number.isFinite(durationMs) || durationMs < MIN_DISPLAYED_THINKING_MS) return undefined
    const seconds = Math.max(MIN_DISPLAYED_THINKING_MS / 1000, Math.floor(durationMs / 100) / 10)
    return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)
}
