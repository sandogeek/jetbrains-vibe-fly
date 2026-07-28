/* eslint-disable */
/* Generated from contracts.ts by generate-rpc-contracts.mjs. Do not edit. */

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
  "startTask": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["startTask"]>,
    Awaited<ReturnType<Ui2AgentContract["startTask"]>>
  >(2),
  "listChatSessions": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["listChatSessions"]>,
    Awaited<ReturnType<Ui2AgentContract["listChatSessions"]>>
  >(3),
  "listRecentChatSessions": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["listRecentChatSessions"]>,
    Awaited<ReturnType<Ui2AgentContract["listRecentChatSessions"]>>
  >(4),
  "openChatSession": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["openChatSession"]>,
    Awaited<ReturnType<Ui2AgentContract["openChatSession"]>>
  >(5),
  "createChatSession": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["createChatSession"]>,
    Awaited<ReturnType<Ui2AgentContract["createChatSession"]>>
  >(6),
  "releaseChatSession": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["releaseChatSession"]>,
    Awaited<ReturnType<Ui2AgentContract["releaseChatSession"]>>
  >(7),
  "sendChatMessage": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["sendChatMessage"]>,
    Awaited<ReturnType<Ui2AgentContract["sendChatMessage"]>>
  >(8),
  "cancelQueuedTurn": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["cancelQueuedTurn"]>,
    Awaited<ReturnType<Ui2AgentContract["cancelQueuedTurn"]>>
  >(9),
  "abortChatTurn": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["abortChatTurn"]>,
    Awaited<ReturnType<Ui2AgentContract["abortChatTurn"]>>
  >(10),
  "listChatModels": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["listChatModels"]>,
    Awaited<ReturnType<Ui2AgentContract["listChatModels"]>>
  >(11),
  "setChatModel": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["setChatModel"]>,
    Awaited<ReturnType<Ui2AgentContract["setChatModel"]>>
  >(12),
  "setChatThinkingLevel": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["setChatThinkingLevel"]>,
    Awaited<ReturnType<Ui2AgentContract["setChatThinkingLevel"]>>
  >(13),
  "markChatSessionRead": rpcMethod<
    RpcMethodArgs<Ui2AgentContract["markChatSessionRead"]>,
    Awaited<ReturnType<Ui2AgentContract["markChatSessionRead"]>>
  >(14),
})

export type Ui2AgentService = RpcService<typeof ui2Agent>

export function createUi2AgentProxy(peer: SimpleRpcPeer): Ui2AgentContract {
  return ui2Agent.createProxy(peer)
}
export const registerUi2AgentService = ui2Agent.register

export const agent2Ui = defineRpcService("Agent2Ui", {
  "onAgentEvent": rpcMethod<
    RpcMethodArgs<Agent2UiContract["onAgentEvent"]>,
    Awaited<ReturnType<Agent2UiContract["onAgentEvent"]>>
  >(1),
  "onChatEvents": rpcMethod<
    RpcMethodArgs<Agent2UiContract["onChatEvents"]>,
    Awaited<ReturnType<Agent2UiContract["onChatEvents"]>>
  >(2),
  "requestToolPermission": rpcMethod<
    RpcMethodArgs<Agent2UiContract["requestToolPermission"]>,
    Awaited<ReturnType<Agent2UiContract["requestToolPermission"]>>
  >(3),
  "requestUserInput": rpcMethod<
    RpcMethodArgs<Agent2UiContract["requestUserInput"]>,
    Awaited<ReturnType<Agent2UiContract["requestUserInput"]>>
  >(4),
})

export type Agent2UiService = RpcService<typeof agent2Ui>

export function createAgent2UiProxy(peer: SimpleRpcPeer): Agent2UiContract {
  return agent2Ui.createProxy(peer)
}
export const registerAgent2UiService = agent2Ui.register
