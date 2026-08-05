package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.RpcFun

/**
 * Settings-panel Host → UI methods (IDE Settings only).
 * Wire service name: Host2UiSettings.
 */
@KotlinCallTs
interface Host2UiSettings {
    /** Web login overlay: open system browser (or show URL). */
    @RpcFun(1)
    suspend fun loginOpenUrl(url: String, launchUrl: String?)

    /** Web login overlay progress text. */
    @RpcFun(2)
    suspend fun loginProgress(message: String)

    /** Web login overlay: collect pasted key/code. */
    @RpcFun(3)
    suspend fun requestLoginInput(prompt: String, placeholder: String?): LoginInputResponse
}
