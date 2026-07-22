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
})

export type Agent2UiService = RpcService<typeof agent2Ui>

export function createAgent2UiProxy(peer: SimpleRpcPeer): Agent2UiContract {
  return agent2Ui.createProxy(peer)
}
export const registerAgent2UiService = agent2Ui.register
