/**
 * Bun ServerWebSocket adapter: ticket hello handshake then SimpleRpc text frames.
 * Pair with @sandogeek/simple-rpc createWebSocketTransport (client).
 */
import {
  SimpleRpcPeer,
  type SimpleRpcTransport,
} from "@sandogeek/simple-rpc"

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000
const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024
const DEFAULT_PATHNAME = "/rpc"

export type HelloAuthResult =
  | { ok: true }
  | { ok: false; code: number; reason: string }

export type AuthenticateHello = (ctx: {
  ticket: string
  origin: string
}) => HelloAuthResult | Promise<HelloAuthResult>

export type BunServerWebSocketRpcSession = {
  readonly peer: SimpleRpcPeer
  readonly origin: string
  close(code?: number, reason?: string): void
}

export type CreateBunServerWebSocketRpcOptions = {
  hostname?: string
  /** Upgrade path. Default `/rpc`. */
  pathname?: string
  maxMessageBytes?: number
  handshakeTimeoutMs?: number
  authenticate: AuthenticateHello
  /** Called after hello_ack is sent; peer is ready for SimpleRpc. */
  onSession: (session: BunServerWebSocketRpcSession) => void
  /** Called when the socket closes after a successful session was established. */
  onSessionClosed?: (session: BunServerWebSocketRpcSession) => void
}

export type BunServerWebSocketRpcServer = {
  readonly port: number
  readonly url: string
  close(): void
}

type WsData = {
  origin: string
  handshakeDone: boolean
  handshakeBusy: boolean
  handshakeTimer: ReturnType<typeof setTimeout> | null
  transport: ServerWsTransport | null
  session: BunServerWebSocketRpcSession | null
}

class ServerWsTransport implements SimpleRpcTransport {
  private handler: ((message: string) => void) | null = null
  private closeListener: (() => void) | null = null
  private closed = false

  constructor(private readonly sendRaw: (message: string) => void) {}

  send(message: string): void {
    if (this.closed) throw new Error("WebSocket transport is closed")
    this.sendRaw(message)
  }

  subscribe(handler: (message: string) => void) {
    this.handler = handler
    return () => {
      if (this.handler === handler) this.handler = null
    }
  }

  onClose(handler: () => void) {
    if (this.closed) {
      queueMicrotask(() => handler())
      return () => {}
    }
    this.closeListener = handler
    return () => {
      if (this.closeListener === handler) this.closeListener = null
    }
  }

  deliver(message: string): void {
    if (!this.closed) this.handler?.(message)
  }

  markClosed(): void {
    if (this.closed) return
    this.closed = true
    const listener = this.closeListener
    this.closeListener = null
    listener?.()
  }
}

/**
 * Bun.serve WebSocket server: first text frame must be hello with ticket;
 * after authenticate + hello_ack, frames are SimpleRpc JSON.
 */
export function createBunServerWebSocketRpc(
  options: CreateBunServerWebSocketRpcOptions,
): BunServerWebSocketRpcServer {
  const hostname = options.hostname ?? "127.0.0.1"
  const pathname = options.pathname ?? DEFAULT_PATHNAME
  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES
  const handshakeTimeoutMs =
    options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS

  const server = Bun.serve<WsData>({
    hostname,
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname !== pathname) {
        return new Response("Not Found", { status: 404 })
      }
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 })
      }
      const origin = req.headers.get("Origin") ?? ""
      const upgraded = srv.upgrade(req, {
        data: {
          origin,
          handshakeDone: false,
          handshakeBusy: false,
          handshakeTimer: null,
          transport: null,
          session: null,
        },
      })
      if (!upgraded) {
        return new Response("Upgrade failed", { status: 500 })
      }
      return undefined as unknown as Response
    },
    websocket: {
      open(ws) {
        ws.data.handshakeTimer = setTimeout(() => {
          if (!ws.data.handshakeDone) {
            ws.close(4000, "handshake timeout")
          }
        }, handshakeTimeoutMs)
      },
      async message(ws, message) {
        if (typeof message !== "string") {
          ws.close(4000, "binary not allowed")
          return
        }
        if (byteLengthUtf8(message) > maxMessageBytes) {
          ws.close(4000, "message too large")
          return
        }

        if (!ws.data.handshakeDone) {
          if (ws.data.handshakeBusy) {
            ws.close(4000, "handshake in progress")
            return
          }
          ws.data.handshakeBusy = true
          try {
            await handleHandshake(ws, message, options)
          } finally {
            ws.data.handshakeBusy = false
          }
          return
        }

        ws.data.transport?.deliver(message)
      },
      close(ws) {
        if (ws.data.handshakeTimer) {
          clearTimeout(ws.data.handshakeTimer)
          ws.data.handshakeTimer = null
        }
        const transport = ws.data.transport
        if (transport) {
          transport.markClosed()
        }
        const session = ws.data.session
        if (session) {
          try {
            session.peer.close()
          } catch {
            // ignore
          }
          ws.data.session = null
          try {
            options.onSessionClosed?.(session)
          } catch {
            // ignore
          }
        }
      },
    },
  })

  const port = server.port
  if (port == null) {
    throw new Error("Bun.serve did not bind a port")
  }

  return {
    port,
    url: `ws://${hostname}:${port}${pathname}`,
    close() {
      server.stop(true)
    },
  }
}

async function handleHandshake(
  ws: {
    data: WsData
    send(data: string): void
    close(code?: number, reason?: string): void
  },
  message: string,
  options: CreateBunServerWebSocketRpcOptions,
): Promise<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(message)
  } catch {
    ws.close(4000, "invalid handshake")
    return
  }
  if (!isHello(parsed)) {
    ws.close(4000, "expected hello")
    return
  }

  let auth: HelloAuthResult
  try {
    auth = await options.authenticate({
      ticket: parsed.ticket,
      origin: ws.data.origin,
    })
  } catch {
    ws.close(4000, "auth failed")
    return
  }
  if (!auth.ok) {
    ws.close(auth.code, auth.reason.slice(0, 120))
    return
  }

  if (ws.data.handshakeTimer) {
    clearTimeout(ws.data.handshakeTimer)
    ws.data.handshakeTimer = null
  }
  ws.data.handshakeDone = true

  const transport = new ServerWsTransport((text) => {
    try {
      ws.send(text)
    } catch {
      // ignore
    }
  })
  ws.data.transport = transport
  const peer = new SimpleRpcPeer(transport)

  const session: BunServerWebSocketRpcSession = {
    peer,
    origin: ws.data.origin,
    close(code = 1000, reason = "server close") {
      try {
        peer.close()
      } catch {
        // ignore
      }
      transport.markClosed()
      try {
        ws.close(code, reason.slice(0, 120))
      } catch {
        // ignore
      }
    },
  }
  ws.data.session = session

  try {
    options.onSession(session)
  } catch {
    session.close(4000, "session setup failed")
    return
  }

  try {
    ws.send(JSON.stringify({ v: 1, kind: "hello_ack" }))
  } catch {
    session.close(4000, "hello_ack failed")
  }
}

function isHello(
  value: unknown,
): value is { v: 1; kind: "hello"; ticket: string } {
  if (value == null || typeof value !== "object") return false
  const o = value as Record<string, unknown>
  return (
    o.v === 1 &&
    o.kind === "hello" &&
    typeof o.ticket === "string" &&
    o.ticket.length > 0
  )
}

function byteLengthUtf8(text: string): number {
  return new TextEncoder().encode(text).byteLength
}
