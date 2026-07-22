import { createCefSimpleRpc, type SimpleRpcPeer } from "@sandogeek/simple-rpc"
import {
  createHostApiProxy,
  registerWebApiService,
  type HostApi,
  type WebApiService,
} from "../generated/rpc"

export type UiRpc = {
  peer: SimpleRpcPeer
  hostApi: HostApi
}

type CefWindow = Window & {
  cefQuery?: (request: {
    request: string
    persistent: boolean
    onSuccess: (response: string) => void
    onFailure: (errorCode: number, errorMessage: string) => void
  }) => number
  cefQueryCancel?: (queryId: number) => void
}

/**
 * Create SimpleRpc peer when running inside JCEF (cefQuery present).
 * Returns null in plain browser / Vite-only preview.
 */
export function createUiRpc(webApi: WebApiService): UiRpc | null {
  const win = window as CefWindow
  if (typeof win.cefQuery !== "function" || typeof win.cefQueryCancel !== "function") {
    return null
  }

  const peer = createCefSimpleRpc({
    query: (req) => win.cefQuery!(req),
    cancelQuery: (id) => win.cefQueryCancel!(id),
  })
  registerWebApiService(peer, webApi)
  return {
    peer,
    hostApi: createHostApiProxy(peer),
  }
}
