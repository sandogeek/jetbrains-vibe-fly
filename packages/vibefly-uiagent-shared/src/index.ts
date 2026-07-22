export type {
  AgentEvent,
  StartTaskRequest,
  TaskId,
} from "./types.js"
export type { Agent2Ui, Ui2Agent } from "./contracts.js"
export { rpcId, rpcService } from "./rpc-annotations.js"

export {
  agent2Ui,
  createAgent2UiProxy,
  createUi2AgentProxy,
  registerAgent2UiService,
  registerUi2AgentService,
  ui2Agent,
  type Agent2UiService,
  type Ui2AgentService,
} from "./contracts.generated.js"
