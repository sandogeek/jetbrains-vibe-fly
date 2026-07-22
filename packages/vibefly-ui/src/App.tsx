import { createSignal, onCleanup, onMount, Show } from "solid-js"
import type { SimpleRpcPeer } from "@sandogeek/simple-rpc"
import type { AgentEvent } from "@vibefly/uiagent-shared"
import { createUiRpc } from "./rpc/client"
import { connectAgentRpc, type AgentStatus } from "./rpc/agent"

export function App() {
  const [hostStatus, setHostStatus] = createSignal("connecting…")
  const [agentStatus, setAgentStatus] = createSignal<AgentStatus>("idle")
  const [version, setVersion] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [lastEvent, setLastEvent] = createSignal<string | null>(null)
  let peer: SimpleRpcPeer | null = null
  let cancelled = false
  let stopAgent: (() => void) | null = null

  onCleanup(() => {
    cancelled = true
    stopAgent?.()
    stopAgent = null
    peer?.close()
    peer = null
  })

  onMount(() => {
    const rpc = createUiRpc({
      setStatus(message) {
        setHostStatus(message)
      },
    })

    if (!rpc) {
      setHostStatus("offline (no cefQuery — open in IDE JCEF)")
      setAgentStatus("unavailable")
      return
    }

    peer = rpc.peer

    void (async () => {
      try {
        await rpc.ui2Host.logFromWeb("ui ready")
        const v = await rpc.ui2Host.getAppVersion()
        if (cancelled) return
        setVersion(v)
        setHostStatus("host connected")

        const agent = connectAgentRpc({
          ui2Host: rpc.ui2Host,
          isStopped: () => cancelled,
          onStatus: (s) => {
            if (!cancelled) setAgentStatus(s)
          },
          onEvent: (event: AgentEvent) => {
            if (cancelled) return
            setLastEvent(JSON.stringify(event))
          },
        })
        stopAgent = agent.stop
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        setHostStatus("error")
      }
    })()
  })

  return (
    <main class="flex min-h-full flex-col items-center justify-center gap-3 p-6">
      <h1 class="m-0 text-4xl font-semibold tracking-wide text-accent">Vibe Fly</h1>
      <p class="m-0 text-sm text-muted">
        SimpleRpc · host CEF · agent WebSocket
      </p>
      <p class="m-0 text-sm text-fg">
        host: <span class="font-mono text-accent">{hostStatus()}</span>
      </p>
      <p class="m-0 text-sm text-fg">
        agent: <span class="font-mono text-accent">{agentStatus()}</span>
      </p>
      <Show when={version()}>
        {(v) => (
          <p class="m-0 text-sm text-fg">
            host version: <span class="font-mono text-accent">{v()}</span>
          </p>
        )}
      </Show>
      <Show when={lastEvent()}>
        {(e) => (
          <p class="m-0 max-w-xl break-all text-xs text-muted font-mono">{e()}</p>
        )}
      </Show>
      <Show when={error()}>
        {(e) => <p class="m-0 text-sm text-muted font-mono">{e()}</p>}
      </Show>
    </main>
  )
}
