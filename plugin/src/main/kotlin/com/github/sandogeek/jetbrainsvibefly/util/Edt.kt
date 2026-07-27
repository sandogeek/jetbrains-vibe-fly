package com.github.sandogeek.jetbrainsvibefly.util

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import kotlinx.coroutines.CompletableDeferred

/**
 * EDT helpers that stay write-safe for model/document changes.
 *
 * Prefer [ApplicationManager.invokeLater] with [ModalityState.defaultModalityState]
 * over [javax.swing.SwingUtilities.invokeLater] or [ModalityState.any]: the latter
 * schedule outside TransactionGuard's write-safe window and can trip
 * "Write-unsafe context! Model changes are allowed from write-safe contexts only."
 */
object Edt {
    /**
     * Run [block] on the EDT under the default modality and await the result.
     * If already on the EDT, runs inline.
     */
    suspend fun <T> run(block: () -> T): T {
        val app = ApplicationManager.getApplication()
        if (app.isDispatchThread) {
            return block()
        }
        val deferred = CompletableDeferred<T>()
        app.invokeLater(
            {
                try {
                    deferred.complete(block())
                } catch (e: Throwable) {
                    deferred.completeExceptionally(e)
                }
            },
            ModalityState.defaultModalityState(),
        )
        return deferred.await()
    }

    /**
     * Schedule [block] on the EDT under the default modality (fire-and-forget).
     * If already on the EDT, runs inline.
     */
    fun later(block: () -> Unit) {
        val app = ApplicationManager.getApplication()
        if (app.isDispatchThread) {
            block()
            return
        }
        app.invokeLater(block, ModalityState.defaultModalityState())
    }
}
