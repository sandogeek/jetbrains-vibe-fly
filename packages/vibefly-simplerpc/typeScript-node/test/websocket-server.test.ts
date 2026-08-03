import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createWebSocketSimpleRpc } from "@sandogeek/simple-rpc"
import {
  createBunServerWebSocketRpc,
  type BunServerWebSocketRpcSession,
} from "../src/index.js"

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("createBunServerWebSocketRpc", () => {
  it("handshakes with ticket and round-trips RPC", async () => {
    let gotTicket = ""
    let gotOrigin = ""
    const sessions: BunServerWebSocketRpcSession[] = []

    const server = createBunServerWebSocketRpc({
      authenticate({ ticket, origin }) {
        gotTicket = ticket
        gotOrigin = origin
        if (ticket !== "good-ticket") {
          return { ok: false, code: 4001, reason: "invalid ticket" }
        }
        return { ok: true }
      },
      onSession(session) {
        sessions.push(session)
        session.peer.register("Echo", 1, async (args) => {
          const [text] = args as [string]
          return `echo:${text}`
        })
      },
    })

    const peer = createWebSocketSimpleRpc({
      url: server.url,
      ticket: "good-ticket",
    })

    for (let i = 0; i < 50; i++) {
      if (sessions.length > 0) break
      await wait(20)
    }
    assert.equal(sessions.length, 1)
    assert.equal(gotTicket, "good-ticket")
    assert.equal(typeof gotOrigin, "string")

    const result = await peer.call<string>("Echo", 1, ["hi"])
    assert.equal(result, "echo:hi")

    peer.close()
    server.close()
  })

  it("rejects invalid ticket", async () => {
    const server = createBunServerWebSocketRpc({
      authenticate() {
        return { ok: false, code: 4001, reason: "invalid ticket" }
      },
      onSession() {
        assert.fail("should not create session")
      },
    })

    const closed = new Promise<number>((resolve) => {
      const ws = new WebSocket(server.url)
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ v: 1, kind: "hello", ticket: "bad" }))
      })
      ws.addEventListener("close", (ev) => {
        resolve((ev as CloseEvent).code)
      })
    })

    assert.equal(await closed, 4001)
    server.close()
  })

  it("rejects non-hello first frame", async () => {
    const server = createBunServerWebSocketRpc({
      authenticate() {
        return { ok: true }
      },
      onSession() {
        assert.fail("should not create session")
      },
    })

    const closed = new Promise<number>((resolve) => {
      const ws = new WebSocket(server.url)
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ v: 1, kind: "not_hello" }))
      })
      ws.addEventListener("close", (ev) => {
        resolve((ev as CloseEvent).code)
      })
    })

    assert.equal(await closed, 4000)
    server.close()
  })
})
