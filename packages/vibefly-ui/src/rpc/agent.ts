import {createWebSocketSimpleRpc, type SimpleRpcPeer,} from "@sandogeek/simple-rpc"
import {
    type Agent2UiService,
    type AgentEvent,
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
 */
export function connectAgentRpc(options: {
    ui2HostChat: Ui2HostChat
    onEvent?: (event: AgentEvent) => void
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

    const stop = () => {
        stopped = true
        if (timer != null) {
            clearTimeout(timer)
            timer = null
        }
        current?.close()
        current = null
        options.onReady?.(null)
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
        const attemptNo = attempt + 1
        const started = performance.now()
        const stageMs = (from: number) => Math.round(performance.now() - from)
        options.onStatus("connecting")
        log.info("agent connecting", {attempt: attemptNo})

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
        const ticketMs = stageMs(ticketStarted)
        if (stopped || options.isStopped()) return
        if (connection == null) {
            log.warn("agent connection unavailable", {
                attempt: attemptNo,
                ticketMs,
                totalMs: stageMs(started),
            })
            options.onStatus("unavailable")
            schedule()
            return
        }
        log.info("agent ticket received", {
            attempt: attemptNo,
            ticketMs,
            url: connection.url,
        })

        const agent2Ui: Agent2UiService = {
            onAgentEvent(event) {
                options.onEvent?.(event)
            },
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

        let peer: SimpleRpcPeer
        const wsStarted = performance.now()
        try {
            peer = createWebSocketSimpleRpc({
                url: connection.url,
                ticket: connection.ticket,
            })
        } catch (e) {
            log.warn("agent websocket create failed", {
                attempt: attemptNo,
                ticketMs,
                wsCreateMs: stageMs(wsStarted),
                totalMs: stageMs(started),
                err: e,
            })
            options.onStatus("unavailable")
            schedule()
            return
        }
        const wsCreateMs = stageMs(wsStarted)

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
        const pingStarted = performance.now()
        try {
            const pong = await ui2Agent.ping("ui")
            const pingMs = stageMs(pingStarted)
            if (stopped || options.isStopped()) {
                current.close()
                current = null
                return
            }
            if (typeof pong === "string") {
                attempt = 0
                options.onStatus("ready")
                options.onReady?.(ui2Agent)
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
            current?.close()
            current = null
            options.onReady?.(null)
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
    return {stop}
}
