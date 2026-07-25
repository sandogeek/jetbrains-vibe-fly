/**
 * Agent WebSocket session: ticket store, origin check, single active UI session.
 * Transport + hello handshake live in @sandogeek/simple-rpc-bun.
 */
import type { SimpleRpcPeer } from "@sandogeek/simple-rpc"
import {
  createBunServerWebSocketRpc,
  type BunServerWebSocketRpcSession,
} from "@sandogeek/simple-rpc-bun"
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
export type AgentWsServer = {
  readonly port: number
  readonly url: string
  setSessionFactory(factory: (peer: SimpleRpcPeer) => void): void
  close(): void
}

const DEFAULT_TICKET_TTL_MS = 30_000

export function createTicketStore(): SessionTicketStore {
  const tickets = new Map<string, TicketRecord>()

  return {
    create(expectedOrigin: string, ttlMs = DEFAULT_TICKET_TTL_MS) {
      const ticket =
        crypto.randomUUID().replace(/-/g, "") +
        crypto.randomUUID().replace(/-/g, "")
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
  let sessionFactory: ((peer: SimpleRpcPeer) => void) | null = null
  let active: BunServerWebSocketRpcSession | null = null

  const server = createBunServerWebSocketRpc({
    hostname: options.hostname,
    authenticate({ ticket, origin }) {
      const rec = options.ticketStore.take(ticket)
      if (!rec) {
        return { ok: false, code: 4001, reason: "invalid ticket" }
      }
      if (rec.used || Date.now() > rec.expiresAtEpochMs) {
        return { ok: false, code: 4001, reason: "ticket expired" }
      }
      if (!origin || origin !== rec.expectedOrigin) {
        log.warn("ws origin mismatch", {
          got: origin,
          expected: rec.expectedOrigin,
        })
        return { ok: false, code: 4003, reason: "origin mismatch" }
      }
      rec.used = true
      return { ok: true }
    },
    onSession(session) {
      // MVP: single active UI session
      if (active) {
        active.close(1000, "replaced")
        active = null
      }
      active = session
      try {
        sessionFactory?.(session.peer)
      } catch (e) {
        log.warn("session factory failed", { err: e })
        session.close(4000, "session setup failed")
        if (active === session) active = null
        return
      }
      log.info("ws session established")
    },
    onSessionClosed(session) {
      if (active === session) {
        active = null
      }
    },
  })

  return {
    port: server.port,
    url: server.url,
    setSessionFactory(factory) {
      sessionFactory = factory
    },
    close() {
      if (active) {
        active.close(1000, "server close")
        active = null
      }
      server.close()
    },
  }
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
