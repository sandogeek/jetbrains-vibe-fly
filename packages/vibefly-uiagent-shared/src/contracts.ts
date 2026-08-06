import type {BrandedRpcOptions, CancelablePromise,} from "@sandogeek/simple-rpc"
import {rpcId, rpcService} from "./rpc-annotations.js"
import type {
  ChatEventBatch,
  ChatModelOption,
  ChatSessionSnapshot,
  ChatSessionSummary,
  ListChatSessionsRequest,
  OpenChatSessionRequest,
  RecentChatSession,
  SendChatMessageRequest,
  SendChatMessageResult,
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

  @rpcId(2)
  listChatSessions(
    request: ListChatSessionsRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<ChatSessionSummary[]> {
    return contractOnly("Ui2Agent.listChatSessions")
  }

  @rpcId(3)
  listRecentChatSessions(
    request: ListChatSessionsRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<RecentChatSession[]> {
    return contractOnly("Ui2Agent.listRecentChatSessions")
  }

  @rpcId(4)
  openChatSession(
    request: OpenChatSessionRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<ChatSessionSnapshot> {
    return contractOnly("Ui2Agent.openChatSession")
  }

  @rpcId(5)
  createChatSession(
    request: ListChatSessionsRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<ChatSessionSnapshot> {
    return contractOnly("Ui2Agent.createChatSession")
  }

  @rpcId(6)
  releaseChatSession(
    sessionId: string,
    options?: BrandedRpcOptions,
  ): CancelablePromise<void> {
    return contractOnly("Ui2Agent.releaseChatSession")
  }

  @rpcId(7)
  sendChatMessage(
    request: SendChatMessageRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<SendChatMessageResult> {
    return contractOnly("Ui2Agent.sendChatMessage")
  }

  @rpcId(8)
  cancelQueuedTurn(
    sessionId: string,
    options?: BrandedRpcOptions,
  ): CancelablePromise<void> {
    return contractOnly("Ui2Agent.cancelQueuedTurn")
  }

  @rpcId(9)
  abortChatTurn(sessionId: string, options?: BrandedRpcOptions): CancelablePromise<void> {
    return contractOnly("Ui2Agent.abortChatTurn")
  }

  @rpcId(10)
  listChatModels(
    sessionId: string,
    options?: BrandedRpcOptions,
  ): CancelablePromise<ChatModelOption[]> {
    return contractOnly("Ui2Agent.listChatModels")
  }

  @rpcId(11)
  setChatModel(
    sessionId: string,
    modelId: string,
    options?: BrandedRpcOptions,
  ): CancelablePromise<ChatSessionSummary> {
    return contractOnly("Ui2Agent.setChatModel")
  }

  @rpcId(12)
  setChatThinkingLevel(
    sessionId: string,
    level: string,
    options?: BrandedRpcOptions,
  ): CancelablePromise<ChatSessionSummary> {
    return contractOnly("Ui2Agent.setChatThinkingLevel")
  }

  @rpcId(13)
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
  @rpcId(1)
  onChatEvents(batch: ChatEventBatch, options?: BrandedRpcOptions): CancelablePromise<void> {
    return contractOnly("Agent2Ui.onChatEvents")
  }

  @rpcId(2)
  requestToolPermission(
    request: ToolPermissionRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<ToolPermissionResponse> {
    return contractOnly("Agent2Ui.requestToolPermission")
  }

  @rpcId(3)
  requestUserInput(
    request: UserInputRequest,
    options?: BrandedRpcOptions,
  ): CancelablePromise<UserInputResponse> {
    return contractOnly("Agent2Ui.requestUserInput")
  }
}
