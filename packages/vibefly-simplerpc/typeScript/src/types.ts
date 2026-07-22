/** Options for outbound RPC calls from TypeScript. */
export interface RpcCallOptions {
  /** Request timeout in milliseconds. Default 30_000; `0` or non-finite disables. */
  timeoutMs?: number
  /** AbortSignal that cancels the in-flight request. */
  signal?: AbortSignal
}

/** Context passed to inbound service implementations (Kotlin → TS). */
export interface RpcCallContext {
  /** Wire request id. */
  requestId: string
  /** AbortSignal aborted when the peer cancels the request. */
  signal: AbortSignal
}

/** Handle returned by service registration; call to unregister. */
export interface RpcRegistration {
  dispose(): void
}

/** Promise that supports explicit cancellation of the in-flight RPC. */
export interface CancelablePromise<T> extends Promise<T> {
  cancel(): void
}

/**
 * Internal wire service descriptor.
 *
 * Prefer {@link defineRpcService} for new contracts. Method values are bare
 * numeric wire ids; call options use branded {@link rpcOptions}.
 */
export interface RpcServiceDescriptor {
  readonly service: string
  readonly methods: Readonly<Record<string, number>>
}

/** Wire protocol message shapes (field names match Kotlin RpcMessage). */
export type WireRequest = {
  t: "req"
  id: string
  s: string
  i: number
  a?: unknown[]
}

export type WireOk = {
  t: "ok"
  id: string
  r?: unknown
}

export type WireErr = {
  t: "err"
  id: string
  e: string
}

export type WireCancel = {
  t: "cancel"
  id: string
}

export type WireMessage = WireRequest | WireOk | WireErr | WireCancel
