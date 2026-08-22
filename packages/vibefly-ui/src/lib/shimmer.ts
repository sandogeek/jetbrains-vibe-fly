/**
 * Shared running-state text shimmer for ChatPage and MessageParts.
 *
 * Truncated titles keep using `vf-shimmer-host` plus a highlight overlay
 * instead of this class, so the real title remains the readable text.
 *
 * Tailwind scans this string, so `shimmer-color-accent` and
 * `shimmer-repeat-delay-800` stay in the production CSS.
 */
export const runningShimmerClassName =
    "shimmer text-muted/55 shimmer-color-accent shimmer-repeat-delay-800"

