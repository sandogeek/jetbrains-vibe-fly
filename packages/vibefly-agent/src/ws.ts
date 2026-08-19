/**
 * Agent WebSocket session: ticket store, origin check, single active UI session.
 * Agent WebSocket session: ticket store, origin check, multiple concurrent UI sessions.
 * Transport + hello handshake live in @sandogeek/simple-rpc-node.
 */
import type {SimpleRpcPeer} from "@sandogeek/simple-rpc"
import {createNodeServerWebSocketRpc, type NodeServerWebSocketRpcSession,} from "@sandogeek/simple-rpc-node"
import {log} from "./log.js"

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
  setSessionFactory(factory: (peer: SimpleRpcPeer) => void | (() => void)): void
  close(): void
}

const DEFAULT_TICKET_TTL_MS = 30_000
/** Cap unused tickets so a stuck issuer cannot grow the map without bound. */
const MAX_TICKETS = 64
const CLEANUP_INTERVAL_MS = 15_000

export function createTicketStore(options?: {
  maxTickets?: number
  cleanupIntervalMs?: number
  now?: () => number
}): SessionTicketStore {
  const tickets = new Map<string, TicketRecord>()
  const maxTickets = options?.maxTickets ?? MAX_TICKETS
  const cleanupIntervalMs = options?.cleanupIntervalMs ?? CLEANUP_INTERVAL_MS
  const now = options?.now ?? Date.now

  function purgeExpired(): void {
    const t = now()
    for (const [key, rec] of tickets) {
      if (t > rec.expiresAtEpochMs) tickets.delete(key)
    }
  }

  const cleanupTimer = setInterval(purgeExpired, cleanupIntervalMs)
  // Do not keep the process alive solely for ticket GC.
  cleanupTimer.unref?.()

  return {
    create(expectedOrigin: string, ttlMs = DEFAULT_TICKET_TTL_MS) {
      if (tickets.size >= maxTickets) {
        purgeExpired()
      }
      if (tickets.size >= maxTickets) {
        // Drop oldest insertion (Map preserves insert order).
        const oldest = tickets.keys().next().value
        if (oldest !== undefined) tickets.delete(oldest)
      }
      const ticket =
        crypto.randomUUID().replace(/-/g, "") +
        crypto.randomUUID().replace(/-/g, "")
      const expiresAtEpochMs = now() + ttlMs
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
      if (rec.used || now() > rec.expiresAtEpochMs) return null
      return rec
    },
    clear() {
      tickets.clear()
      clearInterval(cleanupTimer)
    },
  }
}

export async function createAgentWsServer(options: {
  ticketStore: SessionTicketStore
  hostname?: string
}): Promise<AgentWsServer> {
  let sessionFactory: ((peer: SimpleRpcPeer) => void | (() => void)) | null = null
  const sessions = new Map<NodeServerWebSocketRpcSession, (() => void) | null>()

  const server = await createNodeServerWebSocketRpc({
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
      try {
        sessions.set(session, sessionFactory?.(session.peer) ?? null)
      } catch (e) {
        log.warn("session factory failed", { err: e })
        session.close(4000, "session setup failed")
        sessions.delete(session)
        return
      }
      log.info("ws session established")
    },
    onSessionClosed(session) {
      const cleanup = sessions.get(session)
      if (!sessions.delete(session)) return
      cleanup?.()
    },
  })

  return {
    port: server.port,
    url: server.url,
    setSessionFactory(factory) {
      sessionFactory = factory
    },
    close() {
      for (const [session, cleanup] of sessions) {
        cleanup?.()
        session.close(1000, "server close")
      }
      sessions.clear()
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
