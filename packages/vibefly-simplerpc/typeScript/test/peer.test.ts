import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  SimpleRpcPeer,
  createProxy,
  registerService,
  type SimpleRpcTransport,
} from "../src/index.js"

function loopbackPair(): {
  a: SimpleRpcTransport
  b: SimpleRpcTransport
} {
  let handlerA: ((m: string) => void) | null = null
  let handlerB: ((m: string) => void) | null = null
  return {
    a: {
      send(message) {
        queueMicrotask(() => handlerB?.(message))
      },
      subscribe(handler) {
        handlerA = handler
        return () => {
          if (handlerA === handler) handlerA = null
        }
      },
    },
    b: {
      send(message) {
        queueMicrotask(() => handlerA?.(message))
      },
      subscribe(handler) {
        handlerB = handler
        return () => {
          if (handlerB === handler) handlerB = null
        }
      },
    },
  }
}

describe("SimpleRpcPeer", () => {
  it("proxy request round-trip", async () => {
    const { a, b } = loopbackPair()
    const client = new SimpleRpcPeer(a)
    const server = new SimpleRpcPeer(b)
    server.register("HostApi", 1, async () => "1.0.0")
    server.register("HostApi", 2, async (args) => {
      const [x, y] = args as [number, number]
      return x + y
    })

    const version = await client.call<string>("HostApi", 1, [])
    assert.equal(version, "1.0.0")
    const sum = await client.call<number>("HostApi", 2, [2, 3])
    assert.equal(sum, 5)

    client.close()
    server.close()
  })

  it("createProxy maps method names to ids", async () => {
    const { a, b } = loopbackPair()
    const client = new SimpleRpcPeer(a)
    const server = new SimpleRpcPeer(b)
    server.register("HostApi", 1, async () => "v")
    const descriptor = {
      service: "HostApi",
      methods: { getVersion: 1 },
    } as const
    const api = createProxy<{ getVersion(): Promise<string> }>(
      client,
      descriptor,
    )
    assert.equal(await api.getVersion(), "v")
    client.close()
    server.close()
  })

  it("registerService binds this and dispatches", async () => {
    const { a, b } = loopbackPair()
    const client = new SimpleRpcPeer(a)
    const server = new SimpleRpcPeer(b)
    const descriptor = {
      service: "WebApi",
      methods: { greet: 1, notifyReady: 2 },
    }
    const impl = {
      prefix: "hello",
      greet(name: string) {
        return `${this.prefix} ${name}`
      },
      notifyReady() {},
    }
    const reg = registerService(server, descriptor, impl)
    assert.equal(await client.call("WebApi", 1, ["world"]), "hello world")
    await client.call("WebApi", 2, [])
    reg.dispose()
    await assert.rejects(
      () => client.call("WebApi", 1, ["x"], { timeoutMs: 200 }),
      /Unknown method|timed out/,
    )
    client.close()
    server.close()
  })

  it("remote error propagates", async () => {
    const { a, b } = loopbackPair()
    const client = new SimpleRpcPeer(a)
    const server = new SimpleRpcPeer(b)
    server.register("HostApi", 1, async () => {
      throw new Error("boom")
    })
    await assert.rejects(() => client.call("HostApi", 1, []), /boom/)
    client.close()
    server.close()
  })

  it("timeout sends cancel", async () => {
    const { a, b } = loopbackPair()
    const client = new SimpleRpcPeer(a)
    const server = new SimpleRpcPeer(b)
    const cancels: string[] = []
    const originalSubscribe = b.subscribe.bind(b)
    // wrap server transport via peer internal is hard; observe cancel on server handlers
    server.register("Slow", 1, async (_args, ctx) => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 10_000)
        ctx.signal.addEventListener("abort", () => {
          clearTimeout(t)
          cancels.push(ctx.requestId)
          reject(new Error("RPC cancelled"))
        })
      })
    })
    void originalSubscribe
    await assert.rejects(
      () => client.call("Slow", 1, [], { timeoutMs: 50 }),
      /timed out/,
    )
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(cancels.length, 1)
    client.close()
    server.close()
  })

  it("promise.cancel aborts", async () => {
    const { a, b } = loopbackPair()
    const client = new SimpleRpcPeer(a)
    const server = new SimpleRpcPeer(b)
    let aborted = false
    server.register("Slow", 1, async (_args, ctx) => {
      await new Promise<void>((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () => {
          aborted = true
          reject(new Error("RPC cancelled"))
        })
      })
    })
    const p = client.call("Slow", 1, [], { timeoutMs: 10_000 })
    await new Promise((r) => setTimeout(r, 20))
    p.cancel()
    await assert.rejects(() => p, /cancelled/)
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(aborted, true)
    client.close()
    server.close()
  })

  it("AbortSignal cancels", async () => {
    const { a, b } = loopbackPair()
    const client = new SimpleRpcPeer(a)
    const server = new SimpleRpcPeer(b)
    server.register("Slow", 1, async (_args, ctx) => {
      await new Promise<void>((_resolve, reject) => {
        const t = setTimeout(() => reject(new Error("should have been cancelled")), 10_000)
        ctx.signal.addEventListener("abort", () => {
          clearTimeout(t)
          reject(new Error("RPC cancelled"))
        })
      })
    })
    const ac = new AbortController()
    const p = client.call("Slow", 1, [], { signal: ac.signal, timeoutMs: 10_000 })
    ac.abort()
    await assert.rejects(() => p, /cancelled/)
    client.close()
    server.close()
  })

  it("pre-aborted AbortSignal rejects without wire traffic", async () => {
    const sent: string[] = []
    const transport = {
      send(message: string) {
        sent.push(message)
      },
      subscribe() {
        return () => {}
      },
    }
    const client = new SimpleRpcPeer(transport)
    const ac = new AbortController()
    ac.abort()
    const p = client.call("Any", 1, [], { signal: ac.signal, timeoutMs: 10_000 })
    await assert.rejects(() => p, /cancelled/)
    assert.equal(sent.length, 0)
    client.close()
  })

  it("duplicate service registration throws", () => {
    const { a } = loopbackPair()
    const peer = new SimpleRpcPeer(a)
    const descriptor = { service: "WebApi", methods: { greet: 1 } }
    registerService(peer, descriptor, { greet: () => "x" })
    assert.throws(
      () => registerService(peer, descriptor, { greet: () => "y" }),
      /already registered/,
    )
    peer.close()
  })

  it("stale dispose does not unregister re-registered service", async () => {
    const { a, b } = loopbackPair()
    const client = new SimpleRpcPeer(a)
    const server = new SimpleRpcPeer(b)
    const descriptor = { service: "WebApi", methods: { greet: 1 } }
    const regA = registerService(server, descriptor, { greet: () => "a" })
    regA.dispose()
    const regB = registerService(server, descriptor, { greet: () => "b" })
    regA.dispose() // stale; must not remove B
    assert.equal(await client.call("WebApi", 1, []), "b")
    regB.dispose()
    await assert.rejects(() => client.call("WebApi", 1, [], { timeoutMs: 200 }), /Unknown method/)
    client.close()
    server.close()
  })

  it("failed registerService leaves no partial handlers", () => {
    const { a } = loopbackPair()
    const peer = new SimpleRpcPeer(a)
    const descriptor = {
      service: "WebApi",
      methods: { greet: 1, ping: 2 },
    }
    assert.throws(
      () => registerService(peer, descriptor, { greet: () => "x" }),
      /Missing implementation/,
    )
    const reg = registerService(peer, descriptor, {
      greet: () => "ok",
      ping: () => "pong",
    })
    reg.dispose()
    peer.close()
  })

  it("close rejects pending and rejects new calls", async () => {
    const { a, b } = loopbackPair()
    const client = new SimpleRpcPeer(a)
    new SimpleRpcPeer(b) // no handler
    const p = client.call("X", 1, [], { timeoutMs: 10_000 })
    client.close()
    await assert.rejects(() => p, /closed/)
    await assert.rejects(() => client.call("X", 1, []), /closed/)
  })

  it("unknown service returns err", async () => {
    const { a, b } = loopbackPair()
    const client = new SimpleRpcPeer(a)
    new SimpleRpcPeer(b)
    await assert.rejects(() => client.call("Missing", 9, []), /Unknown method/)
    client.close()
  })
})
