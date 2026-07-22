package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin

/**
 * UI → Host (WebView calls Kotlin) over SimpleRpc / CefMessageRouter.
 * Wire service name: Ui2Host.
 */
@TsCallKotlin
interface Ui2Host {
    @RpcFun(1)
    suspend fun getAppVersion(): String

    @RpcFun(2)
    suspend fun logFromWeb(message: String)

    /**
     * Issue a short-lived Agent WebSocket session.
     * Origin is computed on the Kotlin side from the panel URL; UI cannot supply it.
     * Returns null when the project agent is not ready.
     */
    @RpcFun(3)
    suspend fun getAgentConnection(): AgentConnection?
}
