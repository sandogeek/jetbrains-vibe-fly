package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.RpcFun

/**
 * Shared Host → UI methods for every WebView panel (chat + settings).
 * Wire service name: Host2Ui.
 */
@KotlinCallTs
interface Host2Ui {
    @RpcFun(1)
    suspend fun setStatus(message: String)

    /**
     * Switch WebView theme to match the IDE LAF.
     * [mode] is `"dark"` or `"light"`; UI applies built-in tokens (no host CSS batch).
     */
    @RpcFun(2)
    suspend fun setTheme(mode: String)
}
