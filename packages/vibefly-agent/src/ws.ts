/**
 * Bun ServerWebSocket adapter: ticket handshake then SimpleRpc text frames.
 */
import {
  SimpleRpcPeer,
  type SimpleRpcTransport,
} from "@sandogeek/simple-rpc"
import { log } from "./log.js"

export type TicketRecord = {
  expectedOrigin: string
  expiresAtEpochMs: number
  used: boolean
}

export type SessionTicketStore = {
  take(ticket: string): TicketRecord | null
  create(expectedOrigin: string, ttlMs?: number): { ticket: string; expiresAtEpochMs: number }
  clear(): void
}

export type ActiveWsSession = {
  peer: SimpleRpcPeer
  close(): void
}

export type AgentWsServer = {
  readonly port: number
  readonly url: string
  setSessionFactory(factory: (peer: SimpleRpcPeer) => void): void
  close(): void
}

const HANDSHAKE_TIMEOUT_MS = 10_000
const DEFAULT_TICKET_TTL_MS = 30_000
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024

type WsData = {
  origin: string
  handshakeDone: boolean
  handshakeTimer: ReturnType<typeof setTimeout> | null
  transport: ServerWsTransport | null
}

class ServerWsTransport implements SimpleRpcTransport {
  private handler: ((message: string) => void) | null = null
  private closeListener: (() => void) | null = null
  private closed = false

  constructor(
    private readonly sendRaw: (message: string) => void,
  ) {}

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

export function createTicketStore(): SessionTicketStore {
  const tickets = new Map<string, TicketRecord>()

  return {
    create(expectedOrigin: string, ttlMs = DEFAULT_TICKET_TTL_MS) {
      const ticket = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
      const expiresAtEpochMs = Date.now() + ttlMs
      tickets.set(ticket, {
        expectedOrigin,
        expiresAtEpochMs,
        used: false,
      })
      return { ticket, expiresAtEpochMs }
    },
    take(ticket: string) {
      const rec = tickets.get(ticket)
      if (!rec) return null
      tickets.delete(ticket)
      return rec
    },
    clear() {
      tickets.clear()
    },
  }
}

export function createAgentWsServer(options: {
  ticketStore: SessionTicketStore
  hostname?: string
}): AgentWsServer {
  const hostname = options.hostname ?? "127.0.0.1"
  let sessionFactory: ((peer: SimpleRpcPeer) => void) | null = null
  let active: ActiveWsSession | null = null

  const server = Bun.serve<WsData>({
    hostname,
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname !== "/rpc") {
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
          handshakeTimer: null,
          transport: null,
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
            log("ws handshake timeout")
            ws.close(4000, "handshake timeout")
          }
        }, HANDSHAKE_TIMEOUT_MS)
      },
      message(ws, message) {
        if (typeof message !== "string") {
          ws.close(4000, "binary not allowed")
          return
        }
        if (byteLengthUtf8(message) > MAX_MESSAGE_BYTES) {
          ws.close(4000, "message too large")
          return
        }

        if (!ws.data.handshakeDone) {
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
          const rec = options.ticketStore.take(parsed.ticket)
          if (!rec) {
            ws.close(4001, "invalid ticket")
            return
          }
          if (rec.used || Date.now() > rec.expiresAtEpochMs) {
            ws.close(4001, "ticket expired")
            return
          }
          if (!ws.data.origin || ws.data.origin !== rec.expectedOrigin) {
            log("ws origin mismatch", { got: ws.data.origin, expected: rec.expectedOrigin })
            ws.close(4003, "origin mismatch")
            return
          }
          rec.used = true
          if (ws.data.handshakeTimer) {
            clearTimeout(ws.data.handshakeTimer)
            ws.data.handshakeTimer = null
          }
          ws.data.handshakeDone = true

          // MVP: single active UI session
          if (active) {
            active.close()
            active = null
          }

          const transport = new ServerWsTransport((text) => {
            try {
              ws.send(text)
            } catch {
              // ignore
            }
          })
          ws.data.transport = transport
          const peer = new SimpleRpcPeer(transport)
          const session: ActiveWsSession = {
            peer,
            close() {
              peer.close()
              transport.markClosed()
              try {
                ws.close(1000, "replaced")
              } catch {
                // ignore
              }
            },
          }
          active = session
          try {
            sessionFactory?.(peer)
          } catch (e) {
            log("session factory failed", e)
            session.close()
            active = null
            return
          }
          ws.send(JSON.stringify({ v: 1, kind: "hello_ack" }))
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
        if (active?.peer && ws.data.transport) {
          // Only clear active if this socket owned it
          try {
            active.peer.close()
          } catch {
            // ignore
          }
          active = null
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
    url: `ws://${hostname}:${port}/rpc`,
    setSessionFactory(factory) {
      sessionFactory = factory
    },
    close() {
      if (active) {
        active.close()
        active = null
      }
      server.stop(true)
    },
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

/** Basic absolute-origin validation (scheme://host[:port]). */
export function isValidOrigin(origin: string): boolean {
  try {
    const u = new URL(origin)
    if (u.username || u.password) return false
    if (u.pathname !== "" && u.pathname !== "/") return false
    if (u.search || u.hash) return false
    if (u.protocol !== "http:" && u.protocol !== "https:") return false
    if (!u.hostname) return false
    // Reconstruct and compare to ensure no extra components.
    const port = u.port
    const defaultPort =
      u.protocol === "http:" ? "80" : u.protocol === "https:" ? "443" : ""
    const normalized =
      port && port !== defaultPort
        ? `${u.protocol}//${u.hostname}:${port}`
        : `${u.protocol}//${u.hostname}`
    return normalized === origin
  } catch {
    return false
  }
}
