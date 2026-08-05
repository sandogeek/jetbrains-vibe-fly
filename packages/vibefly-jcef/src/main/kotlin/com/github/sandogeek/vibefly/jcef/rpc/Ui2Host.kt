package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin

/**
 * Shared UI → Host methods for every WebView panel (chat + settings).
 * Wire service name: Ui2Host.
 */
@TsCallKotlin
interface Ui2Host {
    @RpcFun(1)
    suspend fun getAppVersion(): String

    @RpcFun(2)
    suspend fun logFromWeb(message: String)

    /** Read IDE PersistentState snapshot (forms + pin/MRU). No catalog / display names. */
    @RpcFun(3)
    suspend fun getIdeSettings(): IdeSettingsDto

    /**
     * Write IDE settings DTO. Chat panels typically only persist model preferences;
     * settings panels write the full form.
     */
    @RpcFun(4)
    suspend fun saveIdeSettings(settings: IdeSettingsDto)

    @RpcFun(5)
    suspend fun openExternalUrl(url: String)
}
