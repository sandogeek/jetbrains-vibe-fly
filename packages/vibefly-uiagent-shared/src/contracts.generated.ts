/* eslint-disable */
/* Generated from contracts.ts by generate-rpc-contracts.ts. Do not edit. */

import {
  defineRpcService,
  rpcMethod,
  type RpcMethodArgs,
  type RpcService,
  type SimpleRpcPeer,
} from "@sandogeek/simple-rpc"
import type {
  Ui2Agent as Ui2AgentContract,
  Agent2Ui as Agent2UiContract,
} from "./contracts.js"

export const ui2Agent = defineRpcService("Ui2Agent", {
  "ping": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["ping"]>,
    Awaited<ReturnType<Ui2AgentContract["ping"]>>
  >(1),
  "listChatSessions": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["listChatSessions"]>,
    Awaited<ReturnType<Ui2AgentContract["listChatSessions"]>>
  >(2),
  "listRecentChatSessions": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["listRecentChatSessions"]>,
    Awaited<ReturnType<Ui2AgentContract["listRecentChatSessions"]>>
  >(3),
  "openChatSession": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["openChatSession"]>,
    Awaited<ReturnType<Ui2AgentContract["openChatSession"]>>
  >(4),
  "createChatSession": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["createChatSession"]>,
    Awaited<ReturnType<Ui2AgentContract["createChatSession"]>>
  >(5),
  "releaseChatSession": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["releaseChatSession"]>,
    Awaited<ReturnType<Ui2AgentContract["releaseChatSession"]>>
  >(6),
  "sendChatMessage": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["sendChatMessage"]>,
    Awaited<ReturnType<Ui2AgentContract["sendChatMessage"]>>
  >(7),
  "cancelQueuedTurn": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["cancelQueuedTurn"]>,
    Awaited<ReturnType<Ui2AgentContract["cancelQueuedTurn"]>>
  >(8),
  "abortChatTurn": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["abortChatTurn"]>,
    Awaited<ReturnType<Ui2AgentContract["abortChatTurn"]>>
  >(9),
  "listChatModels": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["listChatModels"]>,
    Awaited<ReturnType<Ui2AgentContract["listChatModels"]>>
  >(10),
  "setChatModel": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["setChatModel"]>,
    Awaited<ReturnType<Ui2AgentContract["setChatModel"]>>
  >(11),
  "setChatThinkingLevel": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["setChatThinkingLevel"]>,
    Awaited<ReturnType<Ui2AgentContract["setChatThinkingLevel"]>>
  >(12),
  "markChatSessionRead": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["markChatSessionRead"]>,
    Awaited<ReturnType<Ui2AgentContract["markChatSessionRead"]>>
  >(13),
})

export type Ui2AgentService = RpcService<typeof ui2Agent>

export function createUi2AgentProxy(peer: SimpleRpcPeer): Ui2AgentContract {
  return ui2Agent.createProxy(peer)
}
export const registerUi2AgentService = ui2Agent.register

export const agent2Ui = defineRpcService("Agent2Ui", {
  "onChatEvents": rpcMethod<
    RpcMethodArgs<Agent2UiContract["onChatEvents"]>,
    Awaited<ReturnType<Agent2UiContract["onChatEvents"]>>
  >(1),
  "requestToolPermission": rpcMethod<
    RpcMethodArgs<Agent2UiContract["requestToolPermission"]>,
    Awaited<ReturnType<Agent2UiContract["requestToolPermission"]>>
  >(2),
  "requestUserInput": rpcMethod<
    RpcMethodArgs<Agent2UiContract["requestUserInput"]>,
    Awaited<ReturnType<Agent2UiContract["requestUserInput"]>>
  >(3),
})

export type Agent2UiService = RpcService<typeof agent2Ui>

export function createAgent2UiProxy(peer: SimpleRpcPeer): Agent2UiContract {
  return agent2Ui.createProxy(peer)
}
export const registerAgent2UiService = agent2Ui.register
