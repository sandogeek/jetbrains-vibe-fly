package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin

/**
 * WebView → Kotlin host capabilities over SimpleRpc / CefMessageRouter.
 */
@TsCallKotlin
interface HostApi {
    @RpcFun(1)
    suspend fun getAppVersion(): String

    @RpcFun(2)
    suspend fun logFromWeb(message: String)
}
