/** Logs must go to stderr so stdout stays SimpleRpc-only. */
export function log(...args: unknown[]): void {
  console.error("[vibefly-agent]", ...args)
}
