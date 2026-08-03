package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin

/**
 * Agent → Host (Node calls Kotlin) control-plane callbacks over stdio SimpleRpc.
 * Used for interactive provider login (open browser, prompt, progress) and
 * in-flight commit-message generation progress / keep-alive.
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

    /**
     * Keep-alive / status while [Host2Agent.generateCommitMessage] is in flight.
     * Host resets idle timeout on each call; only silent generation times out.
     */
    @RpcFun(4)
    suspend fun reportCommitMessageProgress(message: String)
}
