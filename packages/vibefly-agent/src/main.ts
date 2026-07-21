/**
 * Vibe Fly Bun agent entrypoint.
 * stdout: SimpleRpc Content-Length frames only
 * stderr: logs
 *
 * Started by the JetBrains plugin as a child process; communicates with the
 * JVM host over stdio using SimpleRpc.
 */
import { createStdioSimpleRpc } from "@sandogeek/simple-rpc-bun"
import { log } from "./log.js"

async function main(): Promise<void> {
  // Ensure accidental console.log never pollutes the RPC stdout stream.
  console.log = (...args: unknown[]) => {
    console.error("[vibefly-agent:stdout-redirect]", ...args)
  }

  const peer = createStdioSimpleRpc({
    input: process.stdin,
    output: process.stdout,
    onClosed: () => {
      log("stdio closed")
      process.exit(0)
    },
  })

  void peer
  log("agent ready")

  process.on("SIGINT", () => process.exit(0))
  process.on("SIGTERM", () => process.exit(0))
}

main().catch((error) => {
  log("fatal", error)
  process.exit(1)
})
