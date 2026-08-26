import assert from "node:assert/strict"
import {describe, it} from "node:test"
import {rpcOptions, SimpleRpcPeer, type SimpleRpcTransport,} from "@sandogeek/simple-rpc"
import {agent2Ui, createUi2AgentProxy, registerUi2AgentService, ui2Agent,} from "../src/index.js"

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
        listChatSessions: 2,
        listRecentChatSessions: 3,
        openChatSession: 4,
        createChatSession: 5,
        releaseChatSession: 6,
        sendChatMessage: 7,
        cancelQueuedTurn: 8,
        abortChatTurn: 9,
        listChatModels: 10,
        setChatModel: 11,
        setChatThinkingLevel: 12,
        markChatSessionRead: 13,
        readSettingValues: 14,
        mutateSettings: 15,
        retryChatTurn: 16,
      },
    })
    assert.deepEqual(agent2Ui.descriptor, {
      service: "Agent2Ui",
      methods: {
        onChatEvents: 1,
        requestToolPermission: 2,
        requestUserInput: 3,
        settingsInvalidated: 4,
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
      readSettingValues() {
        return []
      },
      mutateSettings() {
        return {ok: true, clientMutationId: "unused"}
      },
      retryChatTurn() {
        return { turnId: "turn-retry", state: "running" }
      },
    })

    const proxy = createUi2AgentProxy(clientPeer)
    const call = proxy.ping("ui", rpcOptions({ timeoutMs: 1_000 }))
    assert.equal(typeof call.cancel, "function")
    assert.equal(await call, "pong:ui")

    clientPeer.close()
    serverPeer.close()
  })
})
