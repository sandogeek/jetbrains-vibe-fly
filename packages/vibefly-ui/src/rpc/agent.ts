import {createWebSocketTransport, SimpleRpcPeer} from "@sandogeek/simple-rpc"
import {
    type Agent2UiService,
    type ChatEventBatch,
    createUi2AgentProxy,
    registerAgent2UiService,
    type ToolPermissionRequest,
    type ToolPermissionResponse,
    type Ui2Agent,
    type UserInputRequest,
    type UserInputResponse,
} from "@vibefly/uiagent-shared"
import {log} from "../log"
import type {AgentConnection, Ui2HostChat} from "../generated/rpc"

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
 * Connect UI ↔ Agent WebSocket using Ui2HostChat session tickets.
 * Reconnects with backoff until [stop] or page teardown.
 *
 * Single reconnect state machine: a connection generation token invalidates
 * in-flight attempts and stale transport onClose handlers so an old socket
 * cannot schedule reconnects against a newer connection.
 */
export function connectAgentRpc(options: {
    ui2HostChat: Ui2HostChat
    onChatEvents: (batch: ChatEventBatch) => void
    requestToolPermission: (request: ToolPermissionRequest) => Promise<ToolPermissionResponse>
    requestUserInput: (request: UserInputRequest) => Promise<UserInputResponse>
    onReady?: (agent: Ui2Agent | null) => void
    onStatus: (status: AgentStatus) => void
    isStopped: () => boolean
}): { stop(): void } {
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let current: AgentRpc | null = null
    let stopped = false
    /** Bumped to invalidate in-flight connectOnce and stale onClose handlers. */
    let generation = 0

    const clearTimer = () => {
        if (timer != null) {
            clearTimeout(timer)
            timer = null
        }
    }

    const isLive = (gen: number) =>
        !stopped && !options.isStopped() && gen === generation

    const abandon = (rpc: AgentRpc | null) => {
        if (rpc == null) return
        if (current === rpc) current = null
        try {
            rpc.close()
        } catch {
            // ignore
        }
    }

    const stop = () => {
        stopped = true
        generation += 1
        clearTimer()
        const rpc = current
        current = null
        abandon(rpc)
        options.onReady?.(null)
    }

    /** Schedule reconnect for [gen] (replaces any pending timer). */
    const schedule = (gen: number) => {
        if (!isLive(gen)) return
        clearTimer()
        const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!
        attempt += 1
        timer = setTimeout(() => {
            timer = null
            if (!isLive(gen)) return
            void connectOnce(gen)
        }, delay)
    }

    /**
     * Unexpected transport close for [gen]: claim the generation so intentional
     * peer teardown from the same close path does not double-schedule.
     */
    const onTransportClosed = (gen: number, rpc: AgentRpc) => {
        if (!isLive(gen)) return
        generation += 1
        if (current === rpc) current = null
        options.onReady?.(null)
        log.info("agent closed, reconnecting")
        options.onStatus("closed")
        schedule(generation)
    }

    /** Intentional failure: bump generation so transport close is silent. */
    const failAndReconnect = (gen: number, rpc: AgentRpc | null, status: AgentStatus) => {
        if (!isLive(gen)) return
        generation += 1
        abandon(rpc)
        options.onReady?.(null)
        options.onStatus(status)
        schedule(generation)
    }

    const connectOnce = async (gen: number) => {
        if (!isLive(gen)) return
        const attemptNo = attempt + 1
        const started = performance.now()
        const stageMs = (from: number) => Math.round(performance.now() - from)
        options.onStatus("connecting")
        log.info("agent connecting", {attempt: attemptNo, generation: gen})

        let connection: AgentConnection | null | undefined
        const ticketStarted = performance.now()
        try {
            connection = await options.ui2HostChat.getAgentConnection()
        } catch (e) {
            log.warn("getAgentConnection failed", {
                attempt: attemptNo,
                ticketMs: stageMs(ticketStarted),
                totalMs: stageMs(started),
                err: e,
            })
            connection = null
        }
        if (!isLive(gen)) return
        const ticketMs = stageMs(ticketStarted)
        if (connection == null) {
            log.warn("agent connection unavailable", {
                attempt: attemptNo,
                ticketMs,
                totalMs: stageMs(started),
            })
            failAndReconnect(gen, null, "unavailable")
            return
        }
        log.info("agent ticket received", {
            attempt: attemptNo,
            ticketMs,
            url: connection.url,
        })

        const agent2Ui: Agent2UiService = {
            onChatEvents(batch) {
                options.onChatEvents(batch)
            },
            requestToolPermission(request) {
                return options.requestToolPermission(request)
            },
            requestUserInput(request) {
                return options.requestUserInput(request)
            },
        }

        const wsStarted = performance.now()
        let rpc: AgentRpc
        try {
            // options.onClose runs in addition to transport.onClose (used by peer).
            // Do not call transport.onClose here — it would replace the peer listener.
            let rpcRef: AgentRpc | null = null
            const transport = createWebSocketTransport({
                url: connection.url,
                ticket: connection.ticket,
                onClose: () => {
                    if (rpcRef != null) onTransportClosed(gen, rpcRef)
                },
            })
            const peer = new SimpleRpcPeer(transport)
            rpc = {
                peer,
                ui2Agent: createUi2AgentProxy(peer),
                close() {
                    try {
                        peer.close()
                    } catch {
                        // ignore
                    }
                    try {
                        transport.close()
                    } catch {
                        // ignore
                    }
                },
            }
            rpcRef = rpc
            registerAgent2UiService(peer, agent2Ui)
        } catch (e) {
            log.warn("agent websocket create failed", {
                attempt: attemptNo,
                ticketMs,
                wsCreateMs: stageMs(wsStarted),
                totalMs: stageMs(started),
                err: e,
            })
            failAndReconnect(gen, null, "unavailable")
            return
        }
        const wsCreateMs = stageMs(wsStarted)

        if (!isLive(gen)) {
            abandon(rpc)
            return
        }
        current = rpc

        const pingStarted = performance.now()
        try {
            const pong = await rpc.ui2Agent.ping("ui")
            const pingMs = stageMs(pingStarted)
            if (!isLive(gen)) {
                abandon(rpc)
                return
            }
            if (typeof pong === "string") {
                attempt = 0
                options.onStatus("ready")
                options.onReady?.(rpc.ui2Agent)
                log.info("agent ready", {
                    attempt: attemptNo,
                    ticketMs,
                    wsCreateMs,
                    pingMs,
                    totalMs: stageMs(started),
                })
            }
        } catch (e) {
            log.warn("agent ping failed", {
                attempt: attemptNo,
                ticketMs,
                wsCreateMs,
                pingMs: stageMs(pingStarted),
                totalMs: stageMs(started),
                err: e,
            })
            failAndReconnect(gen, rpc, "unavailable")
        }
    }

    void connectOnce(generation)
    return {stop}
}
