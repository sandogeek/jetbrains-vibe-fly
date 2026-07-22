import { createSignal, onCleanup, onMount, Show } from "solid-js"
import type { SimpleRpcPeer } from "@sandogeek/simple-rpc"
import { createUiRpc } from "./rpc/client"

export function App() {
  const [status, setStatus] = createSignal("connecting…")
  const [version, setVersion] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  let peer: SimpleRpcPeer | null = null
  let cancelled = false

  onCleanup(() => {
    cancelled = true
    peer?.close()
    peer = null
  })

  onMount(() => {
    const rpc = createUiRpc({
      setStatus(message) {
        setStatus(message)
      },
    })

    if (!rpc) {
      setStatus("offline (no cefQuery — open in IDE JCEF)")
      return
    }

    peer = rpc.peer

    void (async () => {
      try {
        await rpc.hostApi.logFromWeb("ui ready")
        const v = await rpc.hostApi.getAppVersion()
        if (cancelled) return
        setVersion(v)
        setStatus("connected")
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        setStatus("error")
      }
    })()
  })

  return (
    <main class="flex min-h-full flex-col items-center justify-center gap-3 p-6">
      <h1 class="m-0 text-4xl font-semibold tracking-wide text-accent">Vibe Fly</h1>
      <p class="m-0 text-sm text-muted">
        SimpleRpc · <code class="font-mono text-[0.85em]">HostApi</code> /{" "}
        <code class="font-mono text-[0.85em]">WebApi</code>
      </p>
      <p class="m-0 text-sm text-fg">
        status: <span class="font-mono text-accent">{status()}</span>
      </p>
      <Show when={version()}>
        {(v) => (
          <p class="m-0 text-sm text-fg">
            host version: <span class="font-mono text-accent">{v()}</span>
          </p>
        )}
      </Show>
      <Show when={error()}>
        {(e) => <p class="m-0 text-sm text-muted font-mono">{e()}</p>}
      </Show>
    </main>
  )
}
