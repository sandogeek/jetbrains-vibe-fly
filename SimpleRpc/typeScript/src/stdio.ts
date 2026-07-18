import type { Readable, Writable } from "node:stream"
import { ContentLengthDecoder, encodeFrame } from "./framing.js"
import { SimpleRpcPeer, type SimpleRpcTransport } from "./peer.js"

export type CreateStdioSimpleRpcOptions = {
  /**
   * Inbound stream carrying framed SimpleRpc messages (e.g. process.stdin when
   * this process is the child, or child.stdout when this process is the parent).
   */
  input: Readable
  /**
   * Outbound stream for framed SimpleRpc messages (e.g. process.stdout as child,
   * or child.stdin as parent).
   */
  output: Writable
  /**
   * Called once when the input stream ends or errors, or when the peer unsubscribes.
   * Use to tear down the session / child process.
   */
  onClosed?: () => void
}

/**
 * Create a [SimpleRpcPeer] over Node readable/writable streams with
 * Content-Length framing (JVM ↔ Node stdio).
 *
 * - Child process (Node agent): `input: process.stdin`, `output: process.stdout`
 * - Parent process: `input: child.stdout`, `output: child.stdin`
 *
 * Protocol JSON must be the only data on the RPC streams. Write logs to stderr.
 *
 * ```ts
 * import { createStdioSimpleRpc } from "@sandogeek/simple-rpc"
 *
 * const rpc = createStdioSimpleRpc({
 *   input: process.stdin,
 *   output: process.stdout,
 * })
 * ```
 */
export function createStdioSimpleRpc(
  options: CreateStdioSimpleRpcOptions,
): SimpleRpcPeer {
  return new SimpleRpcPeer(createStdioTransport(options))
}

/**
 * Build a [SimpleRpcTransport] over streams without constructing a peer.
 * Prefer [createStdioSimpleRpc] for normal use.
 */
export function createStdioTransport(
  options: CreateStdioSimpleRpcOptions,
): SimpleRpcTransport {
  const { input, output, onClosed } = options
  if (input == null || typeof input.on !== "function") {
    throw new Error("createStdioSimpleRpc requires options.input (Readable)")
  }
  if (output == null || typeof output.write !== "function") {
    throw new Error("createStdioSimpleRpc requires options.output (Writable)")
  }

  let handler: ((message: string) => void) | null = null
  let closeListener: (() => void) | null = null
  let closed = false
  const decoder = new ContentLengthDecoder()
  let writeChain: Promise<void> = Promise.resolve()

  const notifyClosed = () => {
    if (closed) return
    closed = true
    try {
      onClosed?.()
    } catch {
      // ignore
    }
    const listener = closeListener
    closeListener = null
    if (listener) {
      try {
        listener()
      } catch {
        // ignore
      }
    }
  }

  const deliver = (messages: string[]) => {
    for (const message of messages) {
      handler?.(message)
    }
  }

  const onData = (chunk: Buffer | string) => {
    if (closed) return
    try {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk
      deliver(decoder.push(buf))
    } catch {
      notifyClosed()
      input.destroy?.()
    }
  }

  const onEnd = () => {
    if (closed) return
    try {
      deliver(decoder.end())
    } catch {
      // partial frame at EOF
    }
    notifyClosed()
  }

  const onError = () => {
    notifyClosed()
  }

  input.on("data", onData)
  input.on("end", onEnd)
  input.on("error", onError)
  output.on("error", onError)

  // Ensure flowing mode for stdin-like streams.
  if (typeof input.resume === "function") {
    input.resume()
  }

  const writeFrame = (frame: Buffer): Promise<void> =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error("Stdio SimpleRpc transport is closed"))
        return
      }
      const onErrorOnce = (err: Error) => {
        notifyClosed()
        reject(err)
      }
      output.once("error", onErrorOnce)
      const canWriteMore = output.write(frame, (err) => {
        if (err) {
          output.off("error", onErrorOnce)
          notifyClosed()
          reject(err)
        }
      })
      if (canWriteMore) {
        output.off("error", onErrorOnce)
        resolve()
      } else {
        output.once("drain", () => {
          output.off("error", onErrorOnce)
          resolve()
        })
      }
    })

  const transport: SimpleRpcTransport = {
    send(message: string) {
      if (closed) {
        throw new Error("Stdio SimpleRpc transport is closed")
      }
      const frame = encodeFrame(message)
      // Serialize writes for ordered delivery; swallow async write errors after notifyClosed.
      writeChain = writeChain.then(() => writeFrame(frame)).catch(() => {})
    },
    subscribe(next: (message: string) => void) {
      handler = next
      return () => {
        if (handler === next) {
          handler = null
        }
        input.off("data", onData)
        input.off("end", onEnd)
        input.off("error", onError)
        output.off("error", onError)
        notifyClosed()
      }
    },
    onClose(next: () => void) {
      if (closed) {
        // Already ended (e.g. race with subscribe teardown): notify asynchronously.
        queueMicrotask(() => {
          try {
            next()
          } catch {
            // ignore
          }
        })
        return () => {}
      }
      closeListener = next
      return () => {
        if (closeListener === next) {
          closeListener = null
        }
      }
    },
  }

  return transport
}
