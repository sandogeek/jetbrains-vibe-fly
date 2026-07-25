import {
  createWebSocketSimpleRpc,
  type SimpleRpcPeer,
} from "@sandogeek/simple-rpc"
import {
  createUi2AgentProxy,
  registerAgent2UiService,
  type Agent2UiService,
  type AgentEvent,
  type Ui2Agent,
} from "@vibefly/uiagent-shared"
import { log } from "../log"
import type { AgentConnection, Ui2Host } from "../generated/rpc"

export type AgentStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "unavailable"
  | "closed"

export type AgentRpc = {
  peer: SimpleRpcPeer
  ui2Agent: Ui2Agent
  close(): void
}

const BACKOFF_MS = [250, 500, 1000, 2000] as const

/**
 * Connect UI ↔ Agent WebSocket using Ui2Host session tickets.
 * Reconnects with backoff until [stop] or page teardown.
 */
export function connectAgentRpc(options: {
  ui2Host: Ui2Host
  onEvent: (event: AgentEvent) => void
  onStatus: (status: AgentStatus) => void
  isStopped: () => boolean
}): { stop(): void } {
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let current: AgentRpc | null = null
  let stopped = false

  const stop = () => {
    stopped = true
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
    current?.close()
    current = null
  }

  const schedule = () => {
    if (stopped || options.isStopped()) return
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!
    attempt += 1
    timer = setTimeout(() => {
      timer = null
      void connectOnce()
    }, delay)
  }

  const connectOnce = async () => {
    if (stopped || options.isStopped()) return
    options.onStatus("connecting")
    log.info("agent connecting")
    let connection: AgentConnection | null | undefined
    try {
      connection = await options.ui2Host.getAgentConnection()
    } catch (e) {
      log.warn("getAgentConnection failed", e)
      connection = null
    }
    if (stopped || options.isStopped()) return
    if (connection == null) {
      log.warn("agent connection unavailable")
      options.onStatus("unavailable")
      schedule()
      return
    }

    const agent2Ui: Agent2UiService = {
      onAgentEvent(event) {
        options.onEvent(event)
      },
    }

    let peer: SimpleRpcPeer
    try {
      peer = createWebSocketSimpleRpc({
        url: connection.url,
        ticket: connection.ticket,
      })
    } catch (e) {
      log.warn("agent websocket create failed", e)
      options.onStatus("unavailable")
      schedule()
      return
    }

    registerAgent2UiService(peer, agent2Ui)
    const ui2Agent = createUi2AgentProxy(peer)
    current = {
      peer,
      ui2Agent,
      close() {
        try {
          peer.close()
        } catch {
          // ignore
        }
      },
    }

    // Probe ready with ping; transport may still be handshaking.
    try {
      const pong = await ui2Agent.ping("ui")
      if (stopped || options.isStopped()) {
        current.close()
        current = null
        return
      }
      if (typeof pong === "string") {
        attempt = 0
        options.onStatus("ready")
        log.info("agent ready")
      }
    } catch (e) {
      log.warn("agent ping failed", e)
      current?.close()
      current = null
      if (!stopped && !options.isStopped()) {
        options.onStatus("unavailable")
        schedule()
      }
      return
    }

    // Peer close → reconnect
    const transportClose = () => {
      if (stopped || options.isStopped()) return
      current = null
      log.info("agent closed, reconnecting")
      options.onStatus("closed")
      schedule()
    }
    // SimpleRpcPeer closes on transport onClose; poll isClosed lightly.
    const watch = setInterval(() => {
      if (stopped || options.isStopped()) {
        clearInterval(watch)
        return
      }
      if (peer.isClosed) {
        clearInterval(watch)
        transportClose()
      }
    }, 500)
  }

  void connectOnce()
  return { stop }
}
