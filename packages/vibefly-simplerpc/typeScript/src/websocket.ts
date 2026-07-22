import { SimpleRpcPeer, type SimpleRpcTransport } from "./peer.js"

const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000

export type WebSocketLike = {
  readonly readyState: number
  readonly CONNECTING: number
  readonly OPEN: number
  readonly CLOSING: number
  readonly CLOSED: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: { data?: unknown; code?: number; reason?: string }) => void,
  ): void
  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: { data?: unknown; code?: number; reason?: string }) => void,
  ): void
}

export type WebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
) => WebSocketLike

export type CreateWebSocketTransportOptions = {
  /** Full WebSocket URL, e.g. ws://127.0.0.1:12345/rpc */
  url: string
  /** One-time ticket from Ui2Host / Host2Agent */
  ticket: string
  /** Max accepted UTF-8 text frame size in bytes. Default 8 MiB. */
  maxMessageBytes?: number
  /** Handshake timeout before hello_ack. Default 10s. */
  handshakeTimeoutMs?: number
  /** Injectable WebSocket (tests / non-browser). Defaults to globalThis.WebSocket. */
  WebSocketImpl?: WebSocketConstructor
  /** Called once when the socket ends after transport setup. */
  onClose?: () => void
}

export type WebSocketTransport = SimpleRpcTransport & {
  /** True after hello_ack. */
  readonly isReady: boolean
  /** Underlying socket; prefer peer.close() for teardown. */
  readonly socket: WebSocketLike
  close(): void
}

type HelloMessage = { v: 1; kind: "hello"; ticket: string }
type HelloAckMessage = { v: 1; kind: "hello_ack" }

/**
 * Browser / client WebSocket transport with ticket handshake.
 *
 * Outbound messages are buffered until hello_ack; only post-handshake text
 * frames are delivered to the peer. Binary frames and oversized messages close
 * the socket. Connection failures are not retried here.
 */
export function createWebSocketTransport(
  options: CreateWebSocketTransportOptions,
): WebSocketTransport {
  const {
    url,
    ticket,
    maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES,
    handshakeTimeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS,
    onClose,
  } = options
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("createWebSocketTransport requires options.url")
  }
  if (typeof ticket !== "string" || ticket.length === 0) {
    throw new Error("createWebSocketTransport requires options.ticket")
  }

  const WebSocketImpl =
    options.WebSocketImpl ??
    (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket
  if (typeof WebSocketImpl !== "function") {
    throw new Error("createWebSocketTransport requires WebSocket")
  }

  const socket = new WebSocketImpl(url)
  let handler: ((message: string) => void) | null = null
  let closeListener: (() => void) | null = null
  let closed = false
  let ready = false
  const outbound: string[] = []
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null

  const failClose = (reason: string) => {
    try {
      socket.close(4000, reason.slice(0, 120))
    } catch {
      // ignore
    }
    markClosed()
  }

  const markClosed = () => {
    if (closed) return
    closed = true
    ready = false
    if (handshakeTimer != null) {
      clearTimeout(handshakeTimer)
      handshakeTimer = null
    }
    outbound.length = 0
    try {
      onClose?.()
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

  const flushOutbound = () => {
    while (outbound.length > 0 && ready && !closed) {
      const next = outbound.shift()
      if (next == null) break
      try {
        socket.send(next)
      } catch {
        failClose("send failed")
        return
      }
    }
  }

  const onOpen = () => {
    if (closed) return
    const hello: HelloMessage = { v: 1, kind: "hello", ticket }
    try {
      socket.send(JSON.stringify(hello))
    } catch {
      failClose("hello send failed")
      return
    }
    handshakeTimer = setTimeout(() => {
      if (!ready && !closed) {
        failClose("handshake timeout")
      }
    }, handshakeTimeoutMs)
  }

  const onMessage = (event: { data?: unknown }) => {
    if (closed) return
    const data = event.data
    if (typeof data !== "string") {
      failClose("binary frames not allowed")
      return
    }
    if (byteLengthUtf8(data) > maxMessageBytes) {
      failClose("message too large")
      return
    }

    if (!ready) {
      let parsed: unknown
      try {
        parsed = JSON.parse(data)
      } catch {
        failClose("invalid handshake")
        return
      }
      if (isHelloAck(parsed)) {
        ready = true
        if (handshakeTimer != null) {
          clearTimeout(handshakeTimer)
          handshakeTimer = null
        }
        flushOutbound()
        return
      }
      failClose("expected hello_ack")
      return
    }

    handler?.(data)
  }

  const onError = () => {
    if (!closed) {
      markClosed()
    }
  }

  const onSocketClose = () => {
    markClosed()
  }

  socket.addEventListener("open", onOpen)
  socket.addEventListener("message", onMessage)
  socket.addEventListener("error", onError)
  socket.addEventListener("close", onSocketClose)

  // Already open (mock sockets)
  if (socket.readyState === socket.OPEN) {
    onOpen()
  }

  const transport: WebSocketTransport = {
    get isReady() {
      return ready
    },
    get socket() {
      return socket
    },
    send(message: string) {
      if (closed) {
        throw new Error("WebSocket transport is closed")
      }
      if (typeof message !== "string") {
        throw new Error("WebSocket transport only sends UTF-8 text")
      }
      if (byteLengthUtf8(message) > maxMessageBytes) {
        throw new Error("message too large")
      }
      if (!ready || socket.readyState !== socket.OPEN) {
        outbound.push(message)
        return
      }
      socket.send(message)
    },
    subscribe(next) {
      handler = next
      return () => {
        if (handler === next) handler = null
      }
    },
    onClose(listener) {
      if (closed) {
        queueMicrotask(() => {
          try {
            listener()
          } catch {
            // ignore
          }
        })
        return () => {}
      }
      closeListener = listener
      return () => {
        if (closeListener === listener) closeListener = null
      }
    },
    close() {
      if (closed) return
      try {
        if (
          socket.readyState === socket.OPEN ||
          socket.readyState === socket.CONNECTING
        ) {
          socket.close(1000, "client close")
        }
      } catch {
        // ignore
      }
      markClosed()
    },
  }

  return transport
}

/**
 * Create a SimpleRpcPeer over an authenticated WebSocket.
 */
export function createWebSocketSimpleRpc(
  options: CreateWebSocketTransportOptions,
): SimpleRpcPeer {
  return new SimpleRpcPeer(createWebSocketTransport(options))
}

function isHelloAck(value: unknown): value is HelloAckMessage {
  if (value == null || typeof value !== "object") return false
  const o = value as Record<string, unknown>
  return o.v === 1 && o.kind === "hello_ack"
}

function byteLengthUtf8(text: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).byteLength
  }
  // Fallback approximate for rare non-browser test hosts without TextEncoder.
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}
