import type {
  BrandedRpcOptions,
  CancelablePromise,
} from "@sandogeek/simple-rpc"
import { rpcId, rpcService } from "./rpc-annotations.js"
import type {
  AgentEvent,
  ChatEventBatch,
  ChatModelOption,
  ChatSessionSnapshot,
  ChatSessionSummary,
  ListChatSessionsRequest,
  OpenChatSessionRequest,
  RecentChatSession,
  SendChatMessageRequest,
  SendChatMessageResult,
  StartTaskRequest,
  TaskId,
  ToolPermissionRequest,
  ToolPermissionResponse,
  UserInputRequest,
  UserInputResponse,
} from "./types.js"

function contractOnly(name: string): never {
  throw new Error(`${name} is an RPC contract; use the generated proxy/service helpers`)
}

/** UI -> Agent methods over WebSocket SimpleRpc. */
@rpcService()
export abstract class Ui2Agent {
  @rpcId(1)
  ping(text: string, options?: BrandedRpcOptions): CancelablePromise<string> {
    return contractOnly("Ui2Agent.ping")
  }

  /** Legacy method retained so its wire id is never reused. */
  @rpcId(2)
  startTask(request: StartTaskRequest, options?: BrandedRpcOptions): CancelablePromise<TaskId> {
    return contractOnly("Ui2Agent.startTask")
  }

  @rpcId(3)
  listChatSessions(
    request: ListChatSessionsRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<ChatSessionSummary[]> {
    return contractOnly("Ui2Agent.listChatSessions")
  }

  @rpcId(4)
  listRecentChatSessions(
    request: ListChatSessionsRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<RecentChatSession[]> {
    return contractOnly("Ui2Agent.listRecentChatSessions")
  }

  @rpcId(5)
  openChatSession(
    request: OpenChatSessionRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<ChatSessionSnapshot> {
    return contractOnly("Ui2Agent.openChatSession")
  }

  @rpcId(6)
  createChatSession(
    request: ListChatSessionsRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<ChatSessionSnapshot> {
    return contractOnly("Ui2Agent.createChatSession")
  }

  @rpcId(7)
  releaseChatSession(
    sessionId: string,
    options?: BrandedRpcOptions,
  ): CancelablePromise<void> {
    return contractOnly("Ui2Agent.releaseChatSession")
  }

  @rpcId(8)
  sendChatMessage(
    request: SendChatMessageRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<SendChatMessageResult> {
    return contractOnly("Ui2Agent.sendChatMessage")
  }

  @rpcId(9)
  cancelQueuedTurn(
    sessionId: string,
    options?: BrandedRpcOptions,
  ): CancelablePromise<void> {
    return contractOnly("Ui2Agent.cancelQueuedTurn")
  }

  @rpcId(10)
  abortChatTurn(sessionId: string, options?: BrandedRpcOptions): CancelablePromise<void> {
    return contractOnly("Ui2Agent.abortChatTurn")
  }

  @rpcId(11)
  listChatModels(
    sessionId: string,
    options?: BrandedRpcOptions,
  ): CancelablePromise<ChatModelOption[]> {
    return contractOnly("Ui2Agent.listChatModels")
  }

  @rpcId(12)
  setChatModel(
    sessionId: string,
    modelId: string,
    options?: BrandedRpcOptions,
  ): CancelablePromise<ChatSessionSummary> {
    return contractOnly("Ui2Agent.setChatModel")
  }

  @rpcId(13)
  setChatThinkingLevel(
    sessionId: string,
    level: string,
    options?: BrandedRpcOptions,
  ): CancelablePromise<ChatSessionSummary> {
    return contractOnly("Ui2Agent.setChatThinkingLevel")
  }

  @rpcId(14)
  markChatSessionRead(
    sessionId: string,
    options?: BrandedRpcOptions,
  ): CancelablePromise<void> {
    return contractOnly("Ui2Agent.markChatSessionRead")
  }
}

/** Agent -> UI methods over WebSocket SimpleRpc. */
@rpcService()
export abstract class Agent2Ui {
  /** Legacy callback retained so its wire id is never reused. */
  @rpcId(1)
  onAgentEvent(event: AgentEvent, options?: BrandedRpcOptions): CancelablePromise<void> {
    return contractOnly("Agent2Ui.onAgentEvent")
  }

  @rpcId(2)
  onChatEvents(batch: ChatEventBatch, options?: BrandedRpcOptions): CancelablePromise<void> {
    return contractOnly("Agent2Ui.onChatEvents")
  }

  @rpcId(3)
  requestToolPermission(
    request: ToolPermissionRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<ToolPermissionResponse> {
    return contractOnly("Agent2Ui.requestToolPermission")
  }

  @rpcId(4)
  requestUserInput(
    request: UserInputRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<UserInputResponse> {
    return contractOnly("Agent2Ui.requestUserInput")
  }
}
