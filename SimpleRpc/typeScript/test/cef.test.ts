import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { EventEmitter } from "node:events"
import {
  createCefSimpleRpc,
  HOST_MESSAGE_EVENT,
} from "../src/index.js"

class TestCustomEvent {
  type: string
  detail: unknown
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type
    this.detail = init?.detail
  }
}

/** Minimal window stub for node tests. */
function installWindowStub() {
  const emitter = new EventEmitter()
  const win = {
    addEventListener(type: string, listener: (event: unknown) => void) {
      emitter.on(type, listener)
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      emitter.off(type, listener)
    },
    dispatchEvent(event: { type: string }) {
      emitter.emit(event.type, event)
      return true
    },
  }
  ;(globalThis as unknown as { window: typeof win; CustomEvent: typeof TestCustomEvent }).window =
    win
  ;(globalThis as unknown as { CustomEvent: typeof TestCustomEvent }).CustomEvent =
    TestCustomEvent
  return win
}

describe("createCefSimpleRpc", () => {
  it("receives host CustomEvent and sends via cefQuery", async () => {
    const win = installWindowStub()
    const sent: string[] = []
    let nextQueryId = 1
    const peer = createCefSimpleRpc({
      query: (req) => {
        sent.push(req.request)
        return nextQueryId++
      },
      cancelQuery: () => {},
    })

    peer.register("HostApi", 1, async () => "ok")

    // Simulate Kotlin deliverToJs CustomEvent
    win.dispatchEvent(
      new TestCustomEvent(HOST_MESSAGE_EVENT, {
        detail: JSON.stringify({
          t: "req",
          id: "k:1:1",
          s: "HostApi",
          i: 1,
          a: [],
        }),
      }),
    )

    await new Promise((r) => setTimeout(r, 30))
    assert.equal(sent.length, 1)
    const response = JSON.parse(sent[0]!) as {
      t: string
      id: string
      r: string
    }
    assert.equal(response.t, "ok")
    assert.equal(response.id, "k:1:1")
    assert.equal(response.r, "ok")

    // Outbound call uses query
    const callPromise = peer.call<string>("Remote", 2, ["x"], {
      timeoutMs: 500,
    })
    // Host responds via event
    const outbound = JSON.parse(sent[1]!) as { t: string; id: string }
    assert.equal(outbound.t, "req")
    win.dispatchEvent(
      new TestCustomEvent(HOST_MESSAGE_EVENT, {
        detail: JSON.stringify({ t: "ok", id: outbound.id, r: "done" }),
      }),
    )
    assert.equal(await callPromise, "done")

    peer.close()
  })

  it("cancelQuery is invoked on cancel", async () => {
    installWindowStub()
    const cancelled: number[] = []
    let qid = 100
    const peer = createCefSimpleRpc({
      query: () => qid++,
      cancelQuery: (id) => {
        cancelled.push(id)
      },
    })
    // No host response — cancel explicitly
    const p = peer.call("X", 1, [], { timeoutMs: 10_000 })
    await new Promise((r) => setTimeout(r, 10))
    p.cancel()
    await assert.rejects(() => p, /cancelled/)
    assert.ok(cancelled.length >= 1)
    peer.close()
  })

  it("cancels outstanding native queries when closed", async () => {
    installWindowStub()
    const cancelled: number[] = []
    let nextQueryId = 200
    const peer = createCefSimpleRpc({
      query: () => nextQueryId++,
      cancelQuery: (id) => {
        cancelled.push(id)
      },
    })

    const first = peer.call("X", 1)
    const second = peer.call("X", 2)
    peer.close()

    await assert.rejects(() => first, /peer closed/)
    await assert.rejects(() => second, /peer closed/)
    assert.deepEqual(cancelled, [200, 201])

    peer.close()
    assert.deepEqual(cancelled, [200, 201])
  })

  it("requires cancelQuery and numeric queryId", async () => {
    installWindowStub()
    assert.throws(
      () =>
        createCefSimpleRpc({
          query: () => 1,
          // @ts-expect-error intentional missing cancelQuery
          cancelQuery: undefined,
        }),
      /cancelQuery/,
    )
    const peer = createCefSimpleRpc({
      query: () => undefined as unknown as number,
      cancelQuery: () => {},
    })
    await assert.rejects(
      () => peer.call("X", 1, [], { timeoutMs: 100 }),
      /numeric queryId/,
    )
    peer.close()
  })

  it("onFailure clears requestQueryIds so cancel does not re-cancel", async () => {
    installWindowStub()
    const cancelled: number[] = []
    let fail: ((code: number, msg: string) => void) | null = null
    const peer = createCefSimpleRpc({
      query: (req) => {
        fail = req.onFailure
        return 55
      },
      cancelQuery: (id) => {
        cancelled.push(id)
      },
    })
    const p = peer.call("X", 1, [], { timeoutMs: 10_000 })
    await new Promise((r) => setTimeout(r, 10))
    fail?.(0, "native fail")
    await assert.rejects(() => p, /native fail/)
    // cancel after failure must not call cancelQuery for a cleared id
    p.cancel()
    assert.equal(cancelled.length, 0)
    peer.close()
  })

  it("does not restore requestQueryIds after synchronous onFailure", async () => {
    const win = installWindowStub()
    const cancelled: number[] = []
    let requestId = ""
    const peer = createCefSimpleRpc({
      query: (req) => {
        requestId = JSON.parse(req.request).id
        req.onFailure(0, "synchronous native fail")
        return 56
      },
      cancelQuery: (id) => {
        cancelled.push(id)
      },
    })

    await assert.rejects(
      () => peer.call("X", 1, [], { timeoutMs: 10_000 }),
      /synchronous native fail/,
    )
    win.dispatchEvent(
      new TestCustomEvent(HOST_MESSAGE_EVENT, {
        detail: JSON.stringify({ t: "cancel", id: requestId }),
      }),
    )

    assert.deepEqual(cancelled, [])
    peer.close()
  })
})
