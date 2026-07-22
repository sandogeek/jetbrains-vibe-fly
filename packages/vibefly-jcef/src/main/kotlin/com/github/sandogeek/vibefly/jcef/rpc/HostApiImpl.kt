package com.github.sandogeek.vibefly.jcef.rpc

import com.intellij.openapi.diagnostic.logger

/**
 * Default [HostApi] for the tool-window WebView session.
 */
class HostApiImpl(
    private val appVersion: String = DEFAULT_VERSION,
) : HostApi {

    override suspend fun getAppVersion(): String = appVersion

    override suspend fun logFromWeb(message: String) {
        log.info("WebView: $message")
    }

    companion object {
        const val DEFAULT_VERSION: String = "0.0.1"
        private val log = logger<HostApiImpl>()
    }
}
