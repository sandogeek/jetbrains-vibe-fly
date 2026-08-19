package com.github.sandogeek.vibefly.jcef.rpc

import com.intellij.ide.BrowserUtil
import com.intellij.openapi.diagnostic.logger

/**
 * Default shared [Ui2Host] for WebView panels.
 */
open class Ui2HostImpl(
    private val appVersion: String = DEFAULT_VERSION,
    private val openExternalUrlHandler: (suspend (String) -> Unit)? = null,
    private val notifyErrorHandler: (suspend (String) -> Unit)? = null,
) : Ui2Host {

    override suspend fun getAppVersion(): String = appVersion

    override suspend fun logFromWeb(message: String) {
        log.info("WebView: $message")
    }

    override suspend fun openExternalUrl(url: String) {
        val target = url.trim()
        if (target.isEmpty()) return
        val handler = openExternalUrlHandler
        if (handler != null) {
            handler(target)
            return
        }
        try {
            BrowserUtil.browse(target)
        } catch (e: Exception) {
            log.warn("BrowserUtil.browse failed", e)
        }
    }

    override suspend fun notifyError(message: String) {
        val text = message.trim()
        if (text.isEmpty()) return
        val handler = notifyErrorHandler
        if (handler != null) {
            handler(text)
            return
        }
        log.warn("notifyError ignored: $text")
    }

    companion object {
        const val DEFAULT_VERSION: String = "0.0.1"
        private val log = logger<Ui2HostImpl>()
    }
}
