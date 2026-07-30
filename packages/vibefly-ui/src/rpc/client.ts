import { createCefSimpleRpc, type SimpleRpcPeer } from "@sandogeek/simple-rpc"
import { log } from "../log"
import {
  createUi2HostProxy,
  registerHost2UiService,
  type Host2UiService,
  type Ui2Host,
} from "../generated/rpc"

export type UiRpc = {
  peer: SimpleRpcPeer
  ui2Host: Ui2Host
}

type CefQueryRequest = {
  request: string
  persistent: boolean
  onSuccess: (response: string) => void
  onFailure: (errorCode: number, errorMessage: string) => void
}

type CefWindow = Window & {
  cefQuery?: (request: CefQueryRequest) => number
  cefQueryCancel?: (queryId: number) => void
}

const RPC_CHANNEL_QUERY_PARAMETER = "vibeflyRpcChannel"

/**
 * Resolve CEF query functions for this frame.
 *
 * New hosts put the exact panel channel in the page URL. Do not scan `window` for
 * a matching function: remote JCEF may inject several routers into one renderer,
 * and enumeration order would route the page to an arbitrary host. Stable names
 * remain as a compatibility fallback for hosts without a channel parameter.
 */
export function resolveCefQueryFns(win: CefWindow): {
  query: (request: CefQueryRequest) => number
  cancel: (queryId: number) => void
} | null {
  const channel = new URLSearchParams(win.location.search).get(RPC_CHANNEL_QUERY_PARAMETER)
  if (channel != null) {
    if (!/^\d+$/.test(channel)) return null
    const functions = win as unknown as Record<string, unknown>
    const queryFn = functions[`vibeflyCefQuery_${channel}`]
    const cancelFn = functions[`vibeflyCefQueryCancel_${channel}`]
    if (typeof queryFn !== "function" || typeof cancelFn !== "function") return null
    return {
      query: (req) => (queryFn as (request: CefQueryRequest) => number)(req),
      cancel: (id) => (cancelFn as (queryId: number) => void)(id),
    }
  }

  if (typeof win.cefQuery === "function" && typeof win.cefQueryCancel === "function") {
    return {
      query: (req) => win.cefQuery!(req),
      cancel: (id) => win.cefQueryCancel!(id),
    }
  }

  return null
}

/**
 * Create SimpleRpc peer when running inside JCEF (cefQuery present).
 * Returns null in plain browser / Vite-only preview.
 */
export function createUiRpc(host2Ui: Host2UiService): UiRpc | null {
  const win = window as CefWindow
  const cef = resolveCefQueryFns(win)
  if (cef == null) {
    log.debug("createUiRpc: cefQuery unavailable")
    return null
  }

  const peer = createCefSimpleRpc({
    query: (req) => cef.query(req),
    cancelQuery: (id) => cef.cancel(id),
  })
  registerHost2UiService(peer, host2Ui)
  return {
    peer,
    ui2Host: createUi2HostProxy(peer),
  }
}
