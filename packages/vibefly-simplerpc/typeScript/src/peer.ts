import { isBrandedRpcOptions } from "./options.js"
import type {
  CancelablePromise,
  RpcCallContext,
  RpcCallOptions,
  RpcRegistration,
  RpcServiceDescriptor,
  WireMessage,
  WireRequest,
} from "./types.js"

const DEFAULT_TIMEOUT_MS = 30_000

export type SimpleRpcUnsubscribe = () => void

export type SimpleRpcTransport = {
  send(message: string): void
  subscribe(handler: (message: string) => void): SimpleRpcUnsubscribe
  /**
   * Optional. Called once when the underlying pipe ends (e.g. stdio EOF).
   * [SimpleRpcPeer] uses this to close and reject pending calls immediately.
   * Return an unsubscribe function, or nothing if unsupported.
   */
  onClose?: (handler: () => void) => SimpleRpcUnsubscribe | void
}

type PendingEntry = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout> | null
  onAbort?: () => void
  signal?: AbortSignal
}

type HandlerEntry = {
  service: string
  methodId: number
  fn: (args: unknown[], context: RpcCallContext) => unknown | Promise<unknown>
}

/**
 * Bidirectional RPC peer: req/ok/err/cancel lifecycle, timeouts, AbortSignal,
 * service registration, and close.
 *
 * When the transport supports [SimpleRpcTransport.onClose] (stdio EOF, etc.),
 * the peer closes automatically and pending calls reject immediately — including
 * requests with `timeoutMs: 0` / no timeout.
 */
export class SimpleRpcPeer {
  private readonly transport: SimpleRpcTransport
  private readonly pending = new Map<string, PendingEntry>()
  private readonly handlers = new Map<string, HandlerEntry>()
  private readonly inflight = new Map<string, AbortController>()
  private readonly registeredServices = new Set<string>()
  private unsubscribe: SimpleRpcUnsubscribe | null = null
  private unsubscribeClose: SimpleRpcUnsubscribe | null = null
  private closed = false
  private requestSequence = 0
  private readonly requestIdPrefix: string

  constructor(transport: SimpleRpcTransport) {
    this.transport = transport
    this.requestIdPrefix =
      "j:" + Date.now().toString(36) + ":" + Math.random().toString(36).slice(2) + ":"
    this.unsubscribe = this.transport.subscribe((raw) => this.onIncoming(raw))
    if (typeof this.transport.onClose === "function") {
      const unsub = this.transport.onClose(() => this.close())
      this.unsubscribeClose = typeof unsub === "function" ? unsub : null
    }
  }

  /**
   * Call a remote method by service name and numeric method id.
   * Returns a Promise with `.cancel()`.
   */
  call<T = unknown>(
    service: string,
    methodId: number,
    args: unknown[] = [],
    options: RpcCallOptions = {},
  ): CancelablePromise<T> {
    if (this.closed) {
      return rejectCancelable(new Error("SimpleRpc peer is closed"))
    }
    const timeoutMs =
      options.timeoutMs != null ? options.timeoutMs : DEFAULT_TIMEOUT_MS
    const requestId = this.nextRequestId()

    const promise = new Promise<T>((resolve, reject) => {
      // Already-aborted signal: reject without timer, cancel, or wire send.
      if (options.signal?.aborted) {
        reject(new Error("RPC cancelled"))
        return
      }

      const entry: PendingEntry = {
        resolve: (v) => resolve(v as T),
        reject,
        timer: null,
        signal: options.signal,
      }
      this.pending.set(requestId, entry)

      if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
        entry.timer = setTimeout(() => {
          if (!this.pending.has(requestId)) return
          this.sendCancel(requestId)
          this.settleReject(
            requestId,
            new Error(`RPC timed out after ${timeoutMs}ms`),
          )
        }, timeoutMs)
      }

      if (options.signal) {
        const onAbort = () => {
          if (!this.pending.has(requestId)) return
          this.sendCancel(requestId)
          this.settleReject(requestId, new Error("RPC cancelled"))
        }
        entry.onAbort = onAbort
        options.signal.addEventListener("abort", onAbort, { once: true })
      }

      try {
        this.send({
          t: "req",
          id: requestId,
          s: service,
          i: methodId,
          a: args,
        })
      } catch (e) {
        this.settleReject(
          requestId,
          e instanceof Error ? e : new Error(String(e)),
        )
      }
    }) as CancelablePromise<T>

    promise.cancel = () => {
      if (!this.pending.has(requestId)) return
      this.sendCancel(requestId)
      this.settleReject(requestId, new Error("RPC cancelled"))
    }

    return promise
  }

  /**
   * Register a single method handler for inbound requests.
   * Prefer [registerService] for descriptor-based bulk registration.
   */
  register(
    service: string,
    methodId: number,
    fn: (args: unknown[], context: RpcCallContext) => unknown | Promise<unknown>,
  ): void {
    if (this.closed) {
      throw new Error("SimpleRpc peer is closed")
    }
    const key = handlerKey(service, methodId)
    if (this.handlers.has(key)) {
      throw new Error(`Duplicate registration for ${key}`)
    }
    this.handlers.set(key, { service, methodId, fn })
  }

  /**
   * Register all methods from a generated descriptor onto [implementation].
   * Implementation methods receive optional trailing RpcCallContext.
   */
  registerService(
    descriptor: RpcServiceDescriptor,
    implementation: Record<string, (...args: never[]) => unknown>,
  ): RpcRegistration {
    if (this.closed) {
      throw new Error("SimpleRpc peer is closed")
    }
    if (this.registeredServices.has(descriptor.service)) {
      throw new Error(`Service already registered: ${descriptor.service}`)
    }
    const prepared: Array<{ key: string; methodId: number; bound: (...args: never[]) => unknown }> =
      []
    const pendingKeys = new Set<string>()
    for (const [methodName, methodId] of Object.entries(descriptor.methods)) {
      const impl = implementation[methodName]
      if (typeof impl !== "function") {
        throw new Error(
          `Missing implementation for ${descriptor.service}.${methodName}`,
        )
      }
      const key = handlerKey(descriptor.service, methodId)
      if (this.handlers.has(key) || pendingKeys.has(key)) {
        throw new Error(`Duplicate registration for ${key}`)
      }
      pendingKeys.add(key)
      prepared.push({
        key,
        methodId,
        bound: impl.bind(implementation),
      })
    }
    const owned = new Map<string, HandlerEntry>()
    for (const item of prepared) {
      const entry: HandlerEntry = {
        service: descriptor.service,
        methodId: item.methodId,
        fn: (args, context) => {
          // Pass optional trailing context; implementations may ignore it.
          return item.bound(...(args as never[]), context as never)
        },
      }
      this.handlers.set(item.key, entry)
      owned.set(item.key, entry)
    }
    this.registeredServices.add(descriptor.service)
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        // Identity-check each handler so stale dispose after re-register
        // cannot delete a newer service's handlers.
        let removedAll = true
        for (const [key, entry] of owned) {
          if (this.handlers.get(key) === entry) {
            this.handlers.delete(key)
          } else {
            removedAll = false
          }
        }
        if (removedAll) {
          this.registeredServices.delete(descriptor.service)
        }
      },
    }
  }

  /** Unregister a single method handler. */
  unregister(service: string, methodId: number): void {
    this.handlers.delete(handlerKey(service, methodId))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.unsubscribeClose) {
      this.unsubscribeClose()
      this.unsubscribeClose = null
    }
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
    for (const [id, entry] of this.pending) {
      this.clearPending(id, entry)
      entry.reject(new Error("SimpleRpc peer closed"))
    }
    this.pending.clear()
    for (const controller of this.inflight.values()) {
      controller.abort()
    }
    this.inflight.clear()
    this.handlers.clear()
    this.registeredServices.clear()
  }

  get isClosed(): boolean {
    return this.closed
  }

  private onIncoming(raw: string): void {
    if (this.closed) return
    let msg: WireMessage
    try {
      msg = typeof raw === "string" ? (JSON.parse(raw) as WireMessage) : (raw as WireMessage)
    } catch {
      return
    }
    switch (msg.t) {
      case "ok": {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.clearPending(msg.id, p)
        this.pending.delete(msg.id)
        p.resolve(msg.r)
        return
      }
      case "err": {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.clearPending(msg.id, p)
        this.pending.delete(msg.id)
        p.reject(new Error(msg.e || "RPC failed"))
        return
      }
      case "cancel": {
        const controller = this.inflight.get(msg.id)
        if (controller) {
          controller.abort()
          this.inflight.delete(msg.id)
        }
        return
      }
      case "req":
        void this.dispatchRequest(msg)
        return
      default:
        return
    }
  }

  private async dispatchRequest(msg: WireRequest): Promise<void> {
    if (msg.i == null) {
      this.send({
        t: "err",
        id: msg.id,
        e: `Missing method id for ${msg.s}`,
      })
      return
    }
    const key = handlerKey(msg.s, msg.i)
    const entry = this.handlers.get(key)
    if (!entry) {
      this.send({
        t: "err",
        id: msg.id,
        e: `Unknown method ${key}`,
      })
      return
    }
    const controller = new AbortController()
    this.inflight.set(msg.id, controller)
    const context: RpcCallContext = {
      requestId: msg.id,
      signal: controller.signal,
    }
    try {
      if (controller.signal.aborted) {
        throw new Error("RPC cancelled")
      }
      const result = await entry.fn(msg.a ?? [], context)
      if (controller.signal.aborted) return
      this.inflight.delete(msg.id)
      this.send({
        t: "ok",
        id: msg.id,
        r: result === undefined ? null : result,
      })
    } catch (err) {
      this.inflight.delete(msg.id)
      if (controller.signal.aborted) return
      this.send({
        t: "err",
        id: msg.id,
        e: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private send(obj: WireMessage): void {
    this.transport.send(JSON.stringify(obj))
  }

  private sendCancel(requestId: string): void {
    try {
      this.send({ t: "cancel", id: requestId })
    } catch {
      // ignore
    }
  }

  private settleReject(requestId: string, err: Error): void {
    const p = this.pending.get(requestId)
    if (!p) return
    this.clearPending(requestId, p)
    this.pending.delete(requestId)
    p.reject(err)
  }

  private clearPending(requestId: string, entry: PendingEntry): void {
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener("abort", entry.onAbort)
    }
    void requestId
  }

  private nextRequestId(): string {
    this.requestSequence += 1
    return this.requestIdPrefix + this.requestSequence.toString(36)
  }
}

function handlerKey(service: string, methodId: number): string {
  return `${service}#${methodId}`
}

function rejectCancelable<T>(err: Error): CancelablePromise<T> {
  const p = Promise.reject(err) as CancelablePromise<T>
  p.cancel = () => {}
  // Prevent unhandled rejection if caller never awaits.
  p.catch(() => {})
  return p
}

/**
 * Create a typed proxy from a generated descriptor.
 * Each method maps to the numeric method id and returns CancelablePromise.
 *
 * Trailing call options are recognized only when branded via {@link rpcOptions}.
 * Unbranded objects (including DTOs with timeoutMs/signal) are sent as business args.
 */
export function createProxy<T extends object>(
  peer: SimpleRpcPeer,
  descriptor: RpcServiceDescriptor,
): T {
  const target = {} as T
  for (const [methodName, methodId] of Object.entries(descriptor.methods)) {
    Object.defineProperty(target, methodName, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: (...allArgs: unknown[]) => {
        let options: RpcCallOptions = {}
        let args = allArgs
        if (allArgs.length > 0 && isBrandedRpcOptions(allArgs[allArgs.length - 1])) {
          options = allArgs[allArgs.length - 1] as RpcCallOptions
          args = allArgs.slice(0, -1)
        }
        // Unbranded trailing objects are always business parameters.
        return peer.call(descriptor.service, methodId, args, options)
      },
    })
  }
  return target
}

/**
 * Register a service implementation using a generated descriptor.
 */
export function registerService(
  peer: SimpleRpcPeer,
  descriptor: RpcServiceDescriptor,
  implementation: object,
): RpcRegistration {
  return peer.registerService(
    descriptor,
    implementation as Record<string, (...args: never[]) => unknown>,
  )
}
