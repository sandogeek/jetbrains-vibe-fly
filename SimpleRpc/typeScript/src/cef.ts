import { SimpleRpcPeer, type SimpleRpcTransport } from "./peer.js"

/** Fixed DOM event name — must match CefMessageRouterTransport.HOST_MESSAGE_EVENT. */
export const HOST_MESSAGE_EVENT = "simplerpc:host-message"

export type CefQueryFn = (request: {
  request: string
  persistent: boolean
  onSuccess: (response: string) => void
  onFailure: (errorCode: number, errorMessage: string) => void
}) => number

export type CefQueryCancelFn = (queryId: number) => void

export type CreateCefSimpleRpcOptions = {
  query: CefQueryFn
  /** Required so TS cancel/timeout can complete the native CEF query. */
  cancelQuery: CefQueryCancelFn
}

/**
 * Create a SimpleRpcPeer wired to JCEF CefMessageRouter.
 *
 * - Outbound: `window.cefQuery` (or provided [query])
 * - Inbound: DOM CustomEvent `simplerpc:host-message` (detail = wire JSON string)
 *
 * The page must call this before Kotlin delivers host messages; early events
 * are not buffered.
 *
 * `query` must return a numeric CEF query id for every call, and `cancelQuery`
 * must be provided, so cancel/timeout can close the native query (not only
 * the wire cancel envelope).
 */
export function createCefSimpleRpc(
  options: CreateCefSimpleRpcOptions,
): SimpleRpcPeer {
  const { query, cancelQuery } = options
  if (typeof query !== "function") {
    throw new Error("createCefSimpleRpc requires options.query")
  }
  if (typeof cancelQuery !== "function") {
    throw new Error("createCefSimpleRpc requires options.cancelQuery")
  }

  const requestQueryIds = new Map<string, number>()
  let failureHandler: ((message: string) => void) | null = null

  const transport: SimpleRpcTransport = {
    send(message: string) {
      let requestId: string | undefined
      let parsed: { t?: string; id?: string } | undefined
      try {
        parsed = JSON.parse(message) as { t?: string; id?: string }
        if (parsed.t === "req" && typeof parsed.id === "string") {
          requestId = parsed.id
        }
      } catch {
        // send raw
      }

      const queryId = query({
        request: message,
        persistent: false,
        onSuccess: () => {
          if (requestId != null) {
            requestQueryIds.delete(requestId)
          }
        },
        onFailure: (code, msg) => {
          if (!requestId) return
          requestQueryIds.delete(requestId)
          failureHandler?.(
            JSON.stringify({
              t: "err",
              id: requestId,
              e: msg || `query failed ${code}`,
            }),
          )
        },
      })

      if (typeof queryId !== "number" || !Number.isFinite(queryId)) {
        throw new Error(
          "createCefSimpleRpc query must return a numeric queryId",
        )
      }

      if (requestId != null) {
        requestQueryIds.set(requestId, queryId)
      }

      if (parsed) {
        if (parsed.t === "cancel" && typeof parsed.id === "string") {
          const qid = requestQueryIds.get(parsed.id)
          if (qid != null) {
            try {
              cancelQuery(qid)
            } catch {
              // ignore
            }
            requestQueryIds.delete(parsed.id)
          }
        }
        if (
          (parsed.t === "ok" || parsed.t === "err") &&
          typeof parsed.id === "string"
        ) {
          requestQueryIds.delete(parsed.id)
        }
      }
    },
    subscribe(handler: (message: string) => void) {
      failureHandler = handler
      const listener = (event: Event) => {
        const detail = (event as CustomEvent<string>).detail
        if (typeof detail === "string") {
          try {
            const msg = JSON.parse(detail) as { t?: string; id?: string }
            if (
              (msg.t === "ok" || msg.t === "err") &&
              typeof msg.id === "string"
            ) {
              requestQueryIds.delete(msg.id)
            }
          } catch {
            // ignore
          }
          handler(detail)
        }
      }
      if (typeof window !== "undefined") {
        window.addEventListener(HOST_MESSAGE_EVENT, listener)
        return () => {
          window.removeEventListener(HOST_MESSAGE_EVENT, listener)
          if (failureHandler === handler) {
            failureHandler = null
          }
        }
      }
      return () => {
        if (failureHandler === handler) {
          failureHandler = null
        }
      }
    },
  }

  return new SimpleRpcPeer(transport)
}
