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
export function createUiRpc(host2Ui: Host2UiService): UiRpc | null {
  const win = window as CefWindow
  if (typeof win.cefQuery !== "function" || typeof win.cefQueryCancel !== "function") {
    log.debug("createUiRpc: cefQuery unavailable")
    return null
  }

  const peer = createCefSimpleRpc({
    query: (req) => win.cefQuery!(req),
    cancelQuery: (id) => win.cefQueryCancel!(id),
  })
  registerHost2UiService(peer, host2Ui)
  return {
    peer,
    ui2Host: createUi2HostProxy(peer),
  }
}
