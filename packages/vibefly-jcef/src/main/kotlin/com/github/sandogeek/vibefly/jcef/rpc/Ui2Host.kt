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

    /** Read a WebView-safe raw settings snapshot. Project paths come from the bound panel. */
    @RpcFun(3)
    suspend fun getSettingsSnapshot(scope: String): UiSettingsSnapshot

    /** Save settings with optimistic concurrency against the target scope revision. */
    @RpcFun(4)
    suspend fun saveSettings(request: SettingsSaveRequest): SettingsSaveResult

    @RpcFun(5)
    suspend fun openExternalUrl(url: String)
}
