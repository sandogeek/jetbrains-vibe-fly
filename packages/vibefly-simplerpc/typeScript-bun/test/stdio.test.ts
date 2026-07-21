import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { PassThrough } from "node:stream"
import {
  createStdioSimpleRpc,
  createStdioTransport,
  encodeFrame,
} from "../src/index.js"

describe("createStdioSimpleRpc", () => {
  it("round-trips RPC over PassThrough streams", async () => {
    // A → B: aOut → bIn
    // B → A: bOut → aIn
    const aToB = new PassThrough()
    const bToA = new PassThrough()

    const peerA = createStdioSimpleRpc({ input: bToA, output: aToB })
    const peerB = createStdioSimpleRpc({ input: aToB, output: bToA })

    peerB.register("HostApi", 1, async (args) => {
      const [name] = args as [string]
      return `hello ${name}`
    })
    peerB.register("HostApi", 2, async (args) => {
      const [x, y] = args as [number, number]
      return x + y
    })

    assert.equal(await peerA.call<string>("HostApi", 1, ["stdio"]), "hello stdio")
    assert.equal(await peerA.call<number>("HostApi", 2, [2, 5]), 7)

    peerA.close()
    peerB.close()
  })

  it("delivers cancel and aborts inbound work", async () => {
    const aToB = new PassThrough()
    const bToA = new PassThrough()
    const peerA = createStdioSimpleRpc({ input: bToA, output: aToB })
    const peerB = createStdioSimpleRpc({ input: aToB, output: bToA })

    let aborted = false
    peerB.register("Slow", 1, async (_args, ctx) => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 5_000)
        ctx.signal.addEventListener("abort", () => {
          aborted = true
          clearTimeout(t)
          reject(new Error("aborted"))
        })
      })
      return "done"
    })

    const p = peerA.call("Slow", 1, [], { timeoutMs: 50 })
    await assert.rejects(() => p, /timed out/)
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(aborted, true)

    peerA.close()
    peerB.close()
  })

  it("onClosed fires when input ends", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let closed = false
    const transport = createStdioTransport({
      input,
      output,
      onClosed: () => {
        closed = true
      },
    })
    const unsub = transport.subscribe(() => {})
    input.end()
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(closed, true)
    unsub()
  })

  it("closes peer and rejects pending when input ends", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const peer = createStdioSimpleRpc({ input, output })
    // timeoutMs: 0 disables the timer — hang forever without transport-driven close.
    const pending = peer.call("Missing", 1, [], { timeoutMs: 0 })
    input.end()
    await assert.rejects(() => pending, /peer closed/)
    assert.equal(peer.isClosed, true)
  })

  it("raw framed bytes are accepted by transport", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const peer = createStdioSimpleRpc({ input, output })
    peer.register("Echo", 1, async (args) => args[0])

    const req = JSON.stringify({
      t: "req",
      id: "j:test:1",
      s: "Echo",
      i: 1,
      a: ["z"],
    })
    input.write(encodeFrame(req))

    const responses: string[] = []
    output.on("data", (chunk: Buffer) => {
      responses.push(chunk.toString("utf8"))
    })
    await new Promise((r) => setTimeout(r, 40))
    assert.ok(responses.some((r) => r.includes('"t":"ok"') && r.includes('"r":"z"')))
    peer.close()
  })
})
