import type {
  BrandedRpcOptions,
  CancelablePromise,
} from "@sandogeek/simple-rpc"
import { rpcId, rpcService } from "./rpc-annotations.js"
import type { AgentEvent, StartTaskRequest, TaskId } from "./types.js"

function contractOnly(name: string): never {
  throw new Error(`${name} is an RPC contract; use the generated proxy/service helpers`)
}

/**
 * UI -> Agent methods over WebSocket SimpleRpc.
 */
@rpcService()
export abstract class Ui2Agent {
  @rpcId(1)
  ping(
    text: string,
    options?: BrandedRpcOptions,
  ): CancelablePromise<string> {
    return contractOnly("Ui2Agent.ping")
  }

  @rpcId(2)
  startTask(
    request: StartTaskRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<TaskId> {
    return contractOnly("Ui2Agent.startTask")
  }
}

/**
 * Agent -> UI methods over WebSocket SimpleRpc.
 */
@rpcService()
export abstract class Agent2Ui {
  @rpcId(1)
  onAgentEvent(
    event: AgentEvent,
    options?: BrandedRpcOptions,
  ): CancelablePromise<void> {
    return contractOnly("Agent2Ui.onAgentEvent")
  }
}
