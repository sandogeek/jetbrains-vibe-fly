package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.Agent2Host
import com.github.sandogeek.vibefly.jcef.rpc.LoginInputRequest
import com.github.sandogeek.vibefly.jcef.rpc.LoginInputResponse
import com.github.sandogeek.vibefly.jcef.rpc.LoginOpenUrlRequest
import com.github.sandogeek.jetbrainsvibefly.util.Edt
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.diagnostic.logger
import java.util.concurrent.atomic.AtomicReference

/**
 * Reverse RPC (Bun → Kotlin) during provider login and commit generation.
 * Active [ProviderLoginUi] is set while a login dialog is running.
 * Active [CommitMessageProgressListener] is set while commit generation is in flight.
 */
object Agent2HostBridge : Agent2Host {

    private val log = logger<Agent2HostBridge>()
    private val activeUi = AtomicReference<ProviderLoginUi?>(null)
    private val commitProgress = AtomicReference<CommitMessageProgressListener?>(null)

    fun <T> withUi(ui: ProviderLoginUi, block: () -> T): T {
        val prev = activeUi.getAndSet(ui)
        try {
            return block()
        } finally {
            activeUi.compareAndSet(ui, prev)
        }
    }

    fun <T> withCommitProgress(listener: CommitMessageProgressListener, block: () -> T): T {
        val prev = commitProgress.getAndSet(listener)
        try {
            return block()
        } finally {
            commitProgress.compareAndSet(listener, prev)
        }
    }

    suspend fun <T> withCommitProgressSuspend(
        listener: CommitMessageProgressListener,
        block: suspend () -> T,
    ): T {
        val prev = commitProgress.getAndSet(listener)
        try {
            return block()
        } finally {
            commitProgress.compareAndSet(listener, prev)
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

    override suspend fun reportCommitMessageProgress(message: String) {
        val listener = commitProgress.get()
        if (listener == null) {
            log.debug("commit progress with no listener: $message")
            return
        }
        listener.onProgress(message)
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

/** Host-side keep-alive for in-flight commit message generation. */
fun interface CommitMessageProgressListener {
    fun onProgress(message: String)
}

private suspend fun <T> runOnEdt(block: () -> T): T = Edt.run(block)
