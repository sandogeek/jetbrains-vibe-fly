import {createCefSimpleRpc, type SimpleRpcPeer} from "@sandogeek/simple-rpc"
import {log} from "../log"
import {
    createUi2HostChatProxy,
    createUi2HostProxy,
    createUi2HostSettingsProxy,
    type Host2UiChatService,
    type Host2UiService,
    type Host2UiSettingsService,
    registerHost2UiChatService,
    registerHost2UiService,
    registerHost2UiSettingsService,
    type Ui2Host,
    type Ui2HostChat,
    type Ui2HostSettings,
} from "../generated/rpc"

export type UiRpc = {
    peer: SimpleRpcPeer
    ui2Host: Ui2Host
}

export type ChatUiRpc = UiRpc & {
    ui2HostChat: Ui2HostChat
}

export type SettingsUiRpc = UiRpc & {
    ui2HostSettings: Ui2HostSettings
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

function openPeer(): SimpleRpcPeer | null {
    const win = window as CefWindow
    const cef = resolveCefQueryFns(win)
    if (cef == null) {
        log.debug("createUiRpc: cefQuery unavailable")
        return null
    }
    return createCefSimpleRpc({
        query: (req) => cef.query(req),
        cancelQuery: (id) => cef.cancel(id),
    })
}

/** Chat tool window: Host2Ui + Host2UiChat; proxies Ui2Host + Ui2HostChat. */
export function createChatUiRpc(options: {
    host2Ui: Host2UiService
    host2UiChat: Host2UiChatService
}): ChatUiRpc | null {
    const peer = openPeer()
    if (peer == null) return null
    registerHost2UiService(peer, options.host2Ui)
    registerHost2UiChatService(peer, options.host2UiChat)
    return {
        peer,
        ui2Host: createUi2HostProxy(peer),
        ui2HostChat: createUi2HostChatProxy(peer),
    }
}

/** Settings panel: Host2Ui + Host2UiSettings; proxies Ui2Host + Ui2HostSettings. */
export function createSettingsUiRpc(options: {
    host2Ui: Host2UiService
    host2UiSettings: Host2UiSettingsService
}): SettingsUiRpc | null {
    const peer = openPeer()
    if (peer == null) return null
    registerHost2UiService(peer, options.host2Ui)
    registerHost2UiSettingsService(peer, options.host2UiSettings)
    return {
        peer,
        ui2Host: createUi2HostProxy(peer),
        ui2HostSettings: createUi2HostSettingsProxy(peer),
    }
}
