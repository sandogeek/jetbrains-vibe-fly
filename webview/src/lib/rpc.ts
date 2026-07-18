import { createCefSimpleRpc, type SimpleRpcPeer } from "@sandogeek/simple-rpc"

let peer: SimpleRpcPeer | null = null

/**
 * Lazily create the CEF SimpleRpc peer.
 * Must run after the page loads; host events before subscribe are dropped.
 */
export function getRpcPeer(): SimpleRpcPeer | null {
  if (peer) return peer
  if (typeof window === "undefined") return null
  if (typeof window.cefQuery !== "function") return null
  if (typeof window.cefQueryCancel !== "function") return null

  peer = createCefSimpleRpc({
    query: window.cefQuery.bind(window),
    cancelQuery: window.cefQueryCancel.bind(window),
  })
  return peer
}

export function isHostConnected(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.cefQuery === "function" &&
    typeof window.cefQueryCancel === "function"
  )
}

export function closeRpcPeer(): void {
  peer?.close()
  peer = null
}
