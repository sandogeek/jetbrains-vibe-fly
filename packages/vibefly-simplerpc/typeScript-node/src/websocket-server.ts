/**
 * Node WebSocket adapter: ticket hello handshake then SimpleRpc text frames.
 * Pair with @sandogeek/simple-rpc createWebSocketTransport (client).
 */
import { createServer, type IncomingMessage } from "node:http"
import {
  SimpleRpcPeer,
  type SimpleRpcTransport,
} from "@sandogeek/simple-rpc"
import {
  WebSocket,
  WebSocketServer,
  type RawData,
} from "ws"

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

export type NodeServerWebSocketRpcSession = {
  readonly peer: SimpleRpcPeer
  readonly origin: string
  close(code?: number, reason?: string): void
}

export type CreateNodeServerWebSocketRpcOptions = {
  hostname?: string
  /** Upgrade path. Default `/rpc`. */
  pathname?: string
  maxMessageBytes?: number
  handshakeTimeoutMs?: number
  authenticate: AuthenticateHello
  /** Called after hello_ack is sent; peer is ready for SimpleRpc. */
  onSession: (session: NodeServerWebSocketRpcSession) => void
  /** Called when the socket closes after a successful session was established. */
  onSessionClosed?: (session: NodeServerWebSocketRpcSession) => void
}

export type NodeServerWebSocketRpcServer = {
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
  session: NodeServerWebSocketRpcSession | null
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
 * Create a Node HTTP/WebSocket server. The first text frame must be hello with
 * a ticket; after authentication + hello_ack, frames are SimpleRpc JSON.
 */
export async function createNodeServerWebSocketRpc(
  options: CreateNodeServerWebSocketRpcOptions,
): Promise<NodeServerWebSocketRpcServer> {
  const hostname = options.hostname ?? "127.0.0.1"
  const pathname = options.pathname ?? DEFAULT_PATHNAME
  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES
  const handshakeTimeoutMs =
    options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS

  const httpServer = createServer((req, res) => {
    if (requestPath(req) !== pathname) {
      res.writeHead(404).end("Not Found")
      return
    }
    if (req.headers.upgrade?.toLowerCase() !== "websocket") {
      res.writeHead(426).end("Expected WebSocket")
      return
    }
    res.writeHead(426).end("WebSocket upgrade required")
  })
  const wsServer = new WebSocketServer({ noServer: true })
  const states = new WeakMap<WebSocket, WsData>()
  const connections = new Set<WebSocket>()

  httpServer.on("upgrade", (req, socket, head) => {
    if (requestPath(req) !== pathname) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
      socket.destroy()
      return
    }
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      const data: WsData = {
        origin: req.headers.origin ?? "",
        handshakeDone: false,
        handshakeBusy: false,
        handshakeTimer: null,
        transport: null,
        session: null,
      }
      states.set(ws, data)
      connections.add(ws)
      wsServer.emit("connection", ws, req)
    })
  })

  wsServer.on("connection", (ws: WebSocket) => {
    const data = states.get(ws)
    if (!data) {
      ws.close(4000, "missing connection state")
      return
    }
    data.handshakeTimer = setTimeout(() => {
      if (!data.handshakeDone) ws.close(4000, "handshake timeout")
    }, handshakeTimeoutMs)

    ws.on("message", async (raw: RawData, isBinary: boolean) => {
      if (isBinary) {
        ws.close(4000, "binary not allowed")
        return
      }
      const message = raw.toString()
      if (Buffer.byteLength(message, "utf8") > maxMessageBytes) {
        ws.close(4000, "message too large")
        return
      }
      if (!data.handshakeDone) {
        if (data.handshakeBusy) {
          ws.close(4000, "handshake in progress")
          return
        }
        data.handshakeBusy = true
        try {
          await handleHandshake(ws, data, message, options)
        } finally {
          data.handshakeBusy = false
        }
        return
      }
      data.transport?.deliver(message)
    })

    ws.on("close", () => {
      connections.delete(ws)
      if (data.handshakeTimer) {
        clearTimeout(data.handshakeTimer)
        data.handshakeTimer = null
      }
      data.transport?.markClosed()
      const session = data.session
      if (!session) return
      try {
        session.peer.close()
      } catch {
        // ignore
      }
      data.session = null
      try {
        options.onSessionClosed?.(session)
      } catch {
        // ignore
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      httpServer.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      httpServer.off("error", onError)
      resolve()
    }
    httpServer.once("error", onError)
    httpServer.once("listening", onListening)
    httpServer.listen(0, hostname)
  })

  const address = httpServer.address()
  if (address == null || typeof address === "string") {
    throw new Error("Node WebSocket server did not bind a port")
  }

  return {
    port: address.port,
    url: `ws://${hostname}:${address.port}${pathname}`,
    close() {
      for (const ws of connections) {
        ws.terminate()
      }
      wsServer.close()
      httpServer.close()
    },
  }
}

async function handleHandshake(
  ws: WebSocket,
  data: WsData,
  message: string,
  options: CreateNodeServerWebSocketRpcOptions,
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
      origin: data.origin,
    })
  } catch {
    ws.close(4000, "auth failed")
    return
  }
  if (!auth.ok) {
    ws.close(auth.code, auth.reason.slice(0, 120))
    return
  }

  if (data.handshakeTimer) {
    clearTimeout(data.handshakeTimer)
    data.handshakeTimer = null
  }
  data.handshakeDone = true

  const transport = new ServerWsTransport((text) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(text)
  })
  data.transport = transport
  const peer = new SimpleRpcPeer(transport)
  const session: NodeServerWebSocketRpcSession = {
    peer,
    origin: data.origin,
    close(code = 1000, reason = "server close") {
      try {
        peer.close()
      } catch {
        // ignore
      }
      transport.markClosed()
      if (ws.readyState === WebSocket.OPEN) ws.close(code, reason.slice(0, 120))
    },
  }
  data.session = session

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

function requestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "http://127.0.0.1").pathname
  } catch {
    return ""
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
