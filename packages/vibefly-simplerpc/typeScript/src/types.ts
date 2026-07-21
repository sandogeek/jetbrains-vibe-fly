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
 * Per-method descriptor entry: the numeric wire id plus the fixed positional
 * arity (number of real params, excluding the trailing options/context arg).
 * Arity lets the proxy locate the optional options object by position instead
 * of guessing by shape, so a DTO argument is never mistaken for options.
 */
export interface RpcMethodDescriptor {
  readonly id: number
  readonly arity: number
}

/**
 * Service descriptor emitted by the Kotlin TypeScriptGenerator.
 *
 * Each method value is either an {@link RpcMethodDescriptor} (preferred, carries
 * arity) or a bare numeric id (legacy; proxy falls back to shape-based options
 * detection).
 */
export interface RpcServiceDescriptor {
  readonly service: string
  readonly methods: Readonly<Record<string, number | RpcMethodDescriptor>>
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
