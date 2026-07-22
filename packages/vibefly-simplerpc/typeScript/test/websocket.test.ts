import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  SimpleRpcPeer,
  createWebSocketTransport,
  type WebSocketConstructor,
  type WebSocketLike,
} from "../src/index.js"

type Listener = (event: { data?: unknown }) => void

class MockWebSocket implements WebSocketLike {
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3

  readyState = 0
  sent: string[] = []
  private listeners = new Map<string, Set<Listener>>()

  constructor(public url: string) {
    queueMicrotask(() => {
      if (this.readyState === this.CONNECTING) {
        this.readyState = this.OPEN
        this.emit("open", {})
      }
    })
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(_code?: number, _reason?: string): void {
    if (this.readyState === this.CLOSED) return
    this.readyState = this.CLOSED
    this.emit("close", {})
  }

  emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }

  deliver(data: unknown): void {
    this.emit("message", { data })
  }
}

function mockWebSocketImpl(): {
  WebSocketImpl: WebSocketConstructor
  last: () => MockWebSocket
} {
  let lastSocket: MockWebSocket | null = null
  class Impl extends MockWebSocket {
    constructor(url: string) {
      super(url)
      lastSocket = this
    }
  }
  return {
    WebSocketImpl: Impl as unknown as WebSocketConstructor,
    last: () => {
      if (!lastSocket) throw new Error("no socket")
      return lastSocket
    },
  }
}

describe("createWebSocketTransport", () => {
  it("buffers outbound until hello_ack then flushes in order", async () => {
    const { WebSocketImpl, last } = mockWebSocketImpl()
    const transport = createWebSocketTransport({
      url: "ws://127.0.0.1:9/rpc",
      ticket: "t1",
      WebSocketImpl,
    })
    transport.send('{"t":"req","id":"1","s":"A","i":1}')
    transport.send('{"t":"req","id":"2","s":"A","i":2}')
    await new Promise((r) => setTimeout(r, 20))
    const client = last()
    assert.equal(client.sent[0], JSON.stringify({ v: 1, kind: "hello", ticket: "t1" }))
    assert.equal(transport.isReady, false)
    assert.equal(client.sent.length, 1)

    client.deliver(JSON.stringify({ v: 1, kind: "hello_ack" }))
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(transport.isReady, true)
    assert.equal(client.sent[1], '{"t":"req","id":"1","s":"A","i":1}')
    assert.equal(client.sent[2], '{"t":"req","id":"2","s":"A","i":2}')
    transport.close()
  })

  it("rejects binary frames", async () => {
    const { WebSocketImpl, last } = mockWebSocketImpl()
    let closed = false
    const transport = createWebSocketTransport({
      url: "ws://127.0.0.1:9/rpc",
      ticket: "t1",
      WebSocketImpl,
      onClose: () => {
        closed = true
      },
    })
    await new Promise((r) => setTimeout(r, 15))
    const client = last()
    client.deliver(JSON.stringify({ v: 1, kind: "hello_ack" }))
    await new Promise((r) => setTimeout(r, 10))
    client.deliver(new Uint8Array([1, 2, 3]))
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(closed, true)
    transport.close()
  })

  it("fails pending on close", async () => {
    const { WebSocketImpl, last } = mockWebSocketImpl()
    const transport = createWebSocketTransport({
      url: "ws://127.0.0.1:9/rpc",
      ticket: "t1",
      WebSocketImpl,
    })
    const peer = new SimpleRpcPeer(transport)
    await new Promise((r) => setTimeout(r, 15))
    last().deliver(JSON.stringify({ v: 1, kind: "hello_ack" }))
    await new Promise((r) => setTimeout(r, 10))
    const p = peer.call("X", 1, [], { timeoutMs: 10_000 })
    transport.close()
    await assert.rejects(() => p, /closed/)
  })

  it("close is idempotent", async () => {
    const { WebSocketImpl } = mockWebSocketImpl()
    const transport = createWebSocketTransport({
      url: "ws://127.0.0.1:9/rpc",
      ticket: "t1",
      WebSocketImpl,
    })
    transport.close()
    transport.close()
  })

  it("enforces max message size", async () => {
    const { WebSocketImpl, last } = mockWebSocketImpl()
    let closed = false
    const transport = createWebSocketTransport({
      url: "ws://127.0.0.1:9/rpc",
      ticket: "t1",
      maxMessageBytes: 32,
      WebSocketImpl,
      onClose: () => {
        closed = true
      },
    })
    await new Promise((r) => setTimeout(r, 15))
    const client = last()
    client.deliver(JSON.stringify({ v: 1, kind: "hello_ack" }))
    await new Promise((r) => setTimeout(r, 10))
    client.deliver("x".repeat(100))
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(closed, true)
    transport.close()
  })
})
