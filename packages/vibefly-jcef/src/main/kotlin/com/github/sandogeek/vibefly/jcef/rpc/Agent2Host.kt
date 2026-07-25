package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin

/**
 * Agent → Host (Bun calls Kotlin) control-plane callbacks over stdio SimpleRpc.
 * Used for interactive provider login (open browser, prompt, progress).
 * Wire service name: Agent2Host.
 */
@TsCallKotlin
interface Agent2Host {
    @RpcFun(1)
    suspend fun openLoginUrl(request: LoginOpenUrlRequest)

    @RpcFun(2)
    suspend fun requestLoginInput(request: LoginInputRequest): LoginInputResponse

    @RpcFun(3)
    suspend fun reportLoginProgress(message: String)
}
