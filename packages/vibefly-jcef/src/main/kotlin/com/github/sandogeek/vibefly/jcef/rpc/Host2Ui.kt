package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.RpcFun

/**
 * Host → UI (Kotlin calls WebView) over SimpleRpc / CefMessageRouter.
 * Wire service name: Host2Ui.
 */
@KotlinCallTs
interface Host2Ui {
    @RpcFun(1)
    suspend fun setStatus(message: String)
}
