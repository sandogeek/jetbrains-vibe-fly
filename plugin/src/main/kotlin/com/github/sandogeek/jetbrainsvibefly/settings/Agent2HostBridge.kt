package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.Agent2Host
import com.github.sandogeek.vibefly.jcef.rpc.LoginInputRequest
import com.github.sandogeek.vibefly.jcef.rpc.LoginInputResponse
import com.github.sandogeek.vibefly.jcef.rpc.LoginOpenUrlRequest
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.diagnostic.logger
import kotlinx.coroutines.CompletableDeferred
import java.util.concurrent.atomic.AtomicReference
import javax.swing.SwingUtilities

/**
 * Reverse RPC (Bun → Kotlin) during provider login.
 * Active [ProviderLoginUi] is set while a login dialog is running.
 */
object Agent2HostBridge : Agent2Host {

    private val log = logger<Agent2HostBridge>()
    private val activeUi = AtomicReference<ProviderLoginUi?>(null)

    fun <T> withUi(ui: ProviderLoginUi, block: () -> T): T {
        val prev = activeUi.getAndSet(ui)
        try {
            return block()
        } finally {
            activeUi.compareAndSet(ui, prev)
        }
    }

    override suspend fun openLoginUrl(request: LoginOpenUrlRequest) {
        val ui = activeUi.get()
        if (ui != null) {
            runOnEdt { ui.onOpenUrl(request) }
            return
        }
        val target = request.launchUrl?.takeIf { it.isNotBlank() } ?: request.url
        if (target.isNotBlank()) {
            try {
                runOnEdt { BrowserUtil.browse(target) }
            } catch (e: Exception) {
                log.warn("BrowserUtil.browse failed for $target", e)
            }
        }
    }

    override suspend fun requestLoginInput(request: LoginInputRequest): LoginInputResponse {
        val ui = activeUi.get()
            ?: return LoginInputResponse(text = "", cancelled = true)
        return ui.requestInput(request)
    }

    override suspend fun reportLoginProgress(message: String) {
        val ui = activeUi.get() ?: return
        runOnEdt { ui.onProgress(message) }
    }
}

/**
 * Host-side callbacks for an in-flight provider login dialog.
 */
interface ProviderLoginUi {
    fun onOpenUrl(request: LoginOpenUrlRequest)

    fun onProgress(message: String)

    suspend fun requestInput(request: LoginInputRequest): LoginInputResponse
}

private suspend fun <T> runOnEdt(block: () -> T): T {
    if (SwingUtilities.isEventDispatchThread()) {
        return block()
    }
    val deferred = CompletableDeferred<T>()
    SwingUtilities.invokeLater {
        try {
            deferred.complete(block())
        } catch (e: Throwable) {
            deferred.completeExceptionally(e)
        }
    }
    return deferred.await()
}
