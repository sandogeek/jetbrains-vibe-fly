import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  SimpleRpcPeer,
  defineRpcService,
  isBrandedRpcOptions,
  rpcMethod,
  rpcOptions,
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

describe("defineRpcService", () => {
  it("rejects duplicate method ids", () => {
    assert.throws(
      () =>
        defineRpcService("Api", {
          a: rpcMethod(1),
          b: rpcMethod(1),
        }),
      /duplicate method id/,
    )
  })

  it("createProxy/register round-trip", async () => {
    const api = defineRpcService("AgentApi", {
      ping: rpcMethod<[text: string], string>(1),
      add: rpcMethod<[a: number, b: number], number>(2),
    })
    const { a, b } = loopbackPair()
    const client = new SimpleRpcPeer(a)
    const server = new SimpleRpcPeer(b)
    api.register(server, {
      ping(text) {
        return `pong:${text}`
      },
      add(x, y) {
        return x + y
      },
    })
    const proxy = api.createProxy(client)
    assert.equal(await proxy.ping("hi"), "pong:hi")
    assert.equal(await proxy.add(2, 3), 5)
    client.close()
    server.close()
  })

  it("stable service name and method ids on descriptor", () => {
    const api = defineRpcService("HostApi", {
      getVersion: rpcMethod<[], string>(1),
      log: rpcMethod<[message: string], void>(2),
    })
    assert.equal(api.name, "HostApi")
    assert.equal(api.descriptor.service, "HostApi")
    assert.equal(api.descriptor.methods.getVersion, 1)
    assert.equal(api.descriptor.methods.log, 2)
  })
})

describe("rpcOptions brand", () => {
  it("strips branded options and applies timeout", async () => {
    const api = defineRpcService("Api", {
      ping: rpcMethod<[], string>(1),
    })
    const { a, b } = loopbackPair()
    const client = new SimpleRpcPeer(a)
    const server = new SimpleRpcPeer(b)
    api.register(server, {
      ping() {
        return new Promise(() => {})
      },
    })
    const proxy = api.createProxy(client)
    await assert.rejects(
      () => proxy.ping(rpcOptions({ timeoutMs: 40 })),
      /timed out/,
    )
    client.close()
    server.close()
  })

  it("sends DTO with timeoutMs as business arg when unbranded", async () => {
    const api = defineRpcService("Api", {
      save: rpcMethod<[dto: { timeoutMs: number }], string>(1),
    })
    const { a, b } = loopbackPair()
    const client = new SimpleRpcPeer(a)
    const server = new SimpleRpcPeer(b)
    let received: unknown[] = []
    api.register(server, {
      save(dto) {
        received = [dto]
        return "ok"
      },
    })
    const proxy = api.createProxy(client)
    await proxy.save({ timeoutMs: 999 })
    assert.deepEqual(received, [{ timeoutMs: 999 }])
    client.close()
    server.close()
  })

  it("does not treat unbranded options-shaped object as options", async () => {
    const api = defineRpcService("Api", {
      ping: rpcMethod<[], string>(1),
    })
    const { a, b } = loopbackPair()
    const client = new SimpleRpcPeer(a)
    const server = new SimpleRpcPeer(b)
    let received: unknown = undefined
    api.register(server, {
      ping(dto: unknown) {
        received = dto
        return "ok"
      },
    })
    const proxy = api.createProxy(client)
    // Unbranded object must go on the wire as an arg (runtime JS misuse path).
    await (proxy.ping as (...args: unknown[]) => Promise<string>)({
      timeoutMs: 30_000,
    })
    assert.deepEqual(received, { timeoutMs: 30_000 })
    client.close()
    server.close()
  })

  it("brand survives Symbol.for across independent wrappers", () => {
    const brand = Symbol.for("@sandogeek/simple-rpc/rpc-options")
    const foreign = { timeoutMs: 10, [brand]: brand }
    assert.equal(isBrandedRpcOptions(foreign), true)
    assert.equal(isBrandedRpcOptions({ timeoutMs: 10 }), false)
    assert.equal(isBrandedRpcOptions(rpcOptions({ timeoutMs: 10 })), true)
  })

  it("brand keys do not enter the wire payload", async () => {
    const sent: string[] = []
    const transport: SimpleRpcTransport = {
      send(message) {
        sent.push(message)
      },
      subscribe() {
        return () => {}
      },
    }
    const peer = new SimpleRpcPeer(transport)
    const api = defineRpcService("Api", {
      ping: rpcMethod<[text: string], string>(1),
    })
    const proxy = api.createProxy(peer)
    void proxy.ping("hi", rpcOptions({ timeoutMs: 5_000 })).catch(() => {})
    await new Promise((r) => setTimeout(r, 5))
    assert.equal(sent.length, 1)
    const body = JSON.parse(sent[0]!) as { a?: unknown[] }
    assert.deepEqual(body.a, ["hi"])
    assert.equal(JSON.stringify(body).includes("rpc-options"), false)
    peer.close()
  })
})
