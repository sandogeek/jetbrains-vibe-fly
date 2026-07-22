package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.RpcFun

/**
 * Kotlin host → WebView callbacks over SimpleRpc / CefMessageRouter.
 */
@KotlinCallTs
interface WebApi {
    @RpcFun(1)
    suspend fun setStatus(message: String)
}
