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

    /** Web login overlay: open system browser (or show URL). */
    @RpcFun(2)
    suspend fun loginOpenUrl(url: String, launchUrl: String?)

    /** Web login overlay progress text. */
    @RpcFun(3)
    suspend fun loginProgress(message: String)

    /** Web login overlay: collect pasted key/code. */
    @RpcFun(4)
    suspend fun requestLoginInput(prompt: String, placeholder: String?): LoginInputResponse
}
