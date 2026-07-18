/**
 * LSP-style Content-Length framing for SimpleRpc over Node streams / stdio.
 *
 * Wire shape:
 * ```
 * Content-Length: <utf8-byte-count>\r\n
 * \r\n
 * <utf-8 json body>
 * ```
 */

const HEADER_END = Buffer.from("\r\n\r\n", "ascii")
const MAX_HEADER_BYTES = 64 * 1024
const MAX_BODY_BYTES = 64 * 1024 * 1024

/** Encode one wire JSON string into a framed Buffer. */
export function encodeFrame(message: string): Buffer {
  const body = Buffer.from(message, "utf8")
  const header = Buffer.from(
    `Content-Length: ${body.byteLength}\r\n\r\n`,
    "ascii",
  )
  return Buffer.concat([header, body])
}

/**
 * Incremental Content-Length frame decoder.
 * Push chunks with [push]; completed frames are returned from [push] and
 * drained via [take] / the return value of [push].
 */
export class ContentLengthDecoder {
  private buffer = Buffer.alloc(0)
  private expectedBody: number | null = null
  private closed = false

  /** True after [end] was called (no more input). */
  get isEnded(): boolean {
    return this.closed
  }

  /**
   * Feed bytes. Returns zero or more complete message strings in arrival order.
   * @throws Error on malformed headers or oversized frames.
   */
  push(chunk: Buffer): string[] {
    if (this.closed) {
      throw new Error("ContentLengthDecoder is ended")
    }
    if (chunk.byteLength === 0) return []
    this.buffer = Buffer.concat([this.buffer, chunk])
    return this.drain()
  }

  /**
   * Mark end-of-stream. Throws if leftover partial frame data remains.
   * Returns any final complete frames still buffered (normally none after last push).
   */
  end(): string[] {
    const frames = this.drain()
    this.closed = true
    if (this.buffer.byteLength > 0 || this.expectedBody != null) {
      throw new Error("Unexpected EOF while reading Content-Length frame")
    }
    return frames
  }

  private drain(): string[] {
    const out: string[] = []
    while (true) {
      if (this.expectedBody == null) {
        const headerEnd = indexOf(this.buffer, HEADER_END)
        if (headerEnd < 0) {
          if (this.buffer.byteLength > MAX_HEADER_BYTES) {
            throw new Error("RPC frame headers exceed 64 KiB")
          }
          break
        }
        const headerBlock = this.buffer.subarray(0, headerEnd)
        this.buffer = this.buffer.subarray(headerEnd + HEADER_END.byteLength)
        this.expectedBody = parseContentLength(headerBlock)
      }
      const length = this.expectedBody
      if (this.buffer.byteLength < length) {
        break
      }
      const body = this.buffer.subarray(0, length)
      this.buffer = this.buffer.subarray(length)
      this.expectedBody = null
      out.push(body.toString("utf8"))
    }
    return out
  }
}

function parseContentLength(headerBlock: Buffer): number {
  const text = headerBlock.toString("ascii")
  let contentLength: number | null = null
  for (const line of text.split("\r\n")) {
    if (!line) continue
    const colon = line.indexOf(":")
    if (colon <= 0) continue
    const name = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (name.toLowerCase() === "content-length") {
      // Reject partial parses (e.g. "1junk", "1.5"); match Kotlin toIntOrNull strictness.
      if (!/^\d+$/.test(value)) {
        throw new Error(`Invalid Content-Length: ${value}`)
      }
      const n = Number.parseInt(value, 10)
      if (!Number.isSafeInteger(n) || n < 0) {
        throw new Error(`Invalid Content-Length: ${value}`)
      }
      contentLength = n
    }
  }
  if (contentLength == null) {
    throw new Error("Missing Content-Length header")
  }
  if (contentLength > MAX_BODY_BYTES) {
    throw new Error(`Content-Length too large: ${contentLength}`)
  }
  return contentLength
}

function indexOf(haystack: Buffer, needle: Buffer): number {
  return haystack.indexOf(needle)
}
