import {
  defineRpcService,
  rpcMethod,
  type RpcClient,
  type RpcService,
} from "@sandogeek/simple-rpc"
import type { AgentEvent, StartTaskRequest, TaskId } from "./types.js"

/** UI → Agent methods over WebSocket SimpleRpc. Wire: Ui2Agent. */
export const ui2Agent = defineRpcService("Ui2Agent", {
  ping: rpcMethod<[text: string], string>(1),
  startTask: rpcMethod<[request: StartTaskRequest], TaskId>(2),
})

export type Ui2Agent = RpcClient<typeof ui2Agent>
export type Ui2AgentService = RpcService<typeof ui2Agent>

export const createUi2AgentProxy = ui2Agent.createProxy
export const registerUi2AgentService = ui2Agent.register

/** Agent → UI methods over WebSocket SimpleRpc. Wire: Agent2Ui. */
export const agent2Ui = defineRpcService("Agent2Ui", {
  onAgentEvent: rpcMethod<[event: AgentEvent], void>(1),
})

export type Agent2Ui = RpcClient<typeof agent2Ui>
export type Agent2UiService = RpcService<typeof agent2Ui>

export const createAgent2UiProxy = agent2Ui.createProxy
export const registerAgent2UiService = agent2Ui.register
