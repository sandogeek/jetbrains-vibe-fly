import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  SimpleRpcPeer,
  rpcOptions,
  type SimpleRpcTransport,
} from "@sandogeek/simple-rpc"
import {
  agent2Ui,
  createUi2AgentProxy,
  registerUi2AgentService,
  ui2Agent,
} from "../src/index.js"

function loopbackPair(): { a: SimpleRpcTransport; b: SimpleRpcTransport } {
  let handlerA: ((message: string) => void) | null = null
  let handlerB: ((message: string) => void) | null = null
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

describe("generated UI-Agent contracts", () => {
  it("preserves service names and stable wire ids", () => {
    assert.deepEqual(ui2Agent.descriptor, {
      service: "Ui2Agent",
      methods: {
        ping: 1,
        startTask: 2,
        listChatSessions: 3,
        listRecentChatSessions: 4,
        openChatSession: 5,
        createChatSession: 6,
        releaseChatSession: 7,
        sendChatMessage: 8,
        cancelQueuedTurn: 9,
        abortChatTurn: 10,
        listChatModels: 11,
        setChatModel: 12,
        setChatThinkingLevel: 13,
        markChatSessionRead: 14,
      },
    })
    assert.deepEqual(agent2Ui.descriptor, {
      service: "Agent2Ui",
      methods: {
        onAgentEvent: 1,
        onChatEvents: 2,
        requestToolPermission: 3,
        requestUserInput: 4,
      },
    })
  })

  it("uses the authored client interface with branded call options", async () => {
    const { a, b } = loopbackPair()
    const clientPeer = new SimpleRpcPeer(a)
    const serverPeer = new SimpleRpcPeer(b)
    registerUi2AgentService(serverPeer, {
      ping(text) {
        return `pong:${text}`
      },
      startTask() {
        return "task-1"
      },
      listChatSessions() {
        return []
      },
      listRecentChatSessions() {
        return []
      },
      openChatSession() {
        throw new Error("not used")
      },
      createChatSession() {
        throw new Error("not used")
      },
      releaseChatSession() {},
      sendChatMessage() {
        return { turnId: "turn-1", state: "running" }
      },
      cancelQueuedTurn() {},
      abortChatTurn() {},
      listChatModels() {
        return []
      },
      setChatModel() {
        throw new Error("not used")
      },
      setChatThinkingLevel() {
        throw new Error("not used")
      },
      markChatSessionRead() {},
    })

    const proxy = createUi2AgentProxy(clientPeer)
    const call = proxy.ping("ui", rpcOptions({ timeoutMs: 1_000 }))
    assert.equal(typeof call.cancel, "function")
    assert.equal(await call, "pong:ui")

    clientPeer.close()
    serverPeer.close()
  })
})
