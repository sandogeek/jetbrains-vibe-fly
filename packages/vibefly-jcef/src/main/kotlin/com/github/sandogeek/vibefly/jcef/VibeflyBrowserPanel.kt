package com.github.sandogeek.vibefly.jcef

import com.github.sandogeek.vibefly.jcef.rpc.Ui2Host
import com.github.sandogeek.vibefly.jcef.rpc.Ui2HostImpl
import com.github.sandogeek.vibefly.jcef.rpc.VibeflyUiRpc
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.awt.BorderLayout
import java.awt.Component
import java.awt.datatransfer.DataFlavor
import java.awt.dnd.DnDConstants
import java.awt.dnd.DropTarget
import java.awt.dnd.DropTargetAdapter
import java.awt.dnd.DropTargetDropEvent
import java.io.File
import javax.swing.JPanel

/**
 * Tool-window host for the vibefly JCEF UI.
 *
 * Production: [VibeflyScheme.INDEX_URL] via classpath.
 * Dev (Vite HMR): [VibeflyUiDev] → e.g. `http://127.0.0.1:5173/`.
 *
 * Dark/light mode follows the current JetBrains LAF via Host2Ui.setTheme RPC
 * ([VibeflyTheme]); the UI applies built-in CSS tokens.
 * WebView ↔ Kotlin: SimpleRpc over CefMessageRouter ([VibeflyUiRpc]).
 *
 * Optional [onFilesDropped] receives absolute local file paths from OS / Project View drops.
 */
class VibeflyBrowserPanel(
    ui2Host: Ui2Host = Ui2HostImpl(),
    /** Hash path without `#` (e.g. `settings`, `settings/providers`). Empty = chat shell. */
    route: String = "",
    /**
     * When set, enables native file drop on the JCEF component.
     * Callback receives absolute filesystem paths for regular files only.
     */
    private val onFilesDropped: ((List<String>) -> Unit)? = null,
) : JPanel(BorderLayout()), Disposable {

    private val browser: JBCefBrowser
    private val uiRpc: VibeflyUiRpc
    private val themeScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile
    private var disposed: Boolean = false

    init {
        // Always register so absolute http://vibefly/ assets still work if referenced.
        VibeflyScheme.ensureRegistered()
        val startUrl = VibeflyStartUrl.withRoute(VibeflyUiDev.resolveStartUrl(), route)
        if (VibeflyUiDev.isEnabled()) {
            log.info("Vibefly UI dev (Vite HMR): $startUrl")
        }
        background = UIUtil.getPanelBackground()
        isOpaque = true
        // Remote/out-of-process JCEF requires OSR; platform default enables it when
        // ide.browser.jcef.out-of-process.enabled (or ide.browser.jcef.osr.enabled).
        // Forcing windowed mode only logs a WARN and is ignored under remote mode.
        browser = JBCefBrowser.createBuilder().build()
        add(browser.component, BorderLayout.CENTER)
        Disposer.register(this, browser)
        // MessageRouter must be registered before the page creates createCefSimpleRpc.
        uiRpc = VibeflyUiRpc.attach(browser, this, ui2Host)

        browser.jbCefClient.addLoadHandler(
            object : CefLoadHandlerAdapter() {
                override fun onLoadEnd(
                    cefBrowser: CefBrowser?,
                    frame: CefFrame?,
                    httpStatusCode: Int,
                ) {
                    if (frame == null || !frame.isMain) return
                    // Host2Ui may not be registered until Solid mounts; retry briefly.
                    applyTheme(retry = true)
                }
            },
            browser.cefBrowser,
        )

        ApplicationManager.getApplication().messageBus
            .connect(this)
            .subscribe(
                LafManagerListener.TOPIC,
                LafManagerListener {
                    background = UIUtil.getPanelBackground()
                    applyTheme(retry = false)
                },
            )

        installFileDropHandler()

        // Theme is pushed over RPC after load / LAF change.
        browser.loadURL(startUrl)
    }

    val jbCefBrowser: JBCefBrowser
        get() = browser

    /** SimpleRpc session for this panel (Ui2Host registered; [host2Ui] proxies into the page). */
    val rpc: VibeflyUiRpc
        get() = uiRpc

    private fun installFileDropHandler() {
        val handler = onFilesDropped ?: return
        // Use DropTarget only (not TransferHandler): setting both on the same component
        // replaces Swing's TransferHandler DropTarget. Install on real CEF UI as well as
        // Swing wrappers so windowed (Canvas) and OSR modes both receive drops.
        val dropListener = object : DropTargetAdapter() {
            override fun drop(dtde: DropTargetDropEvent) {
                if (!dtde.isDataFlavorSupported(DataFlavor.javaFileListFlavor)) {
                    dtde.rejectDrop()
                    return
                }
                val source = dtde.sourceActions
                val canCopyOrMove =
                    (source and DnDConstants.ACTION_COPY) != 0 ||
                        (source and DnDConstants.ACTION_MOVE) != 0
                if (!canCopyOrMove) {
                    dtde.rejectDrop()
                    return
                }
                try {
                    dtde.acceptDrop(DnDConstants.ACTION_COPY)
                    val files = dtde.transferable
                        .getTransferData(DataFlavor.javaFileListFlavor) as? List<*>
                    val paths = files
                        ?.filterIsInstance<File>()
                        ?.filter { it.isFile }
                        ?.map { it.absolutePath }
                        .orEmpty()
                    if (paths.isNotEmpty()) {
                        handler(paths)
                        dtde.dropComplete(true)
                    } else {
                        dtde.dropComplete(false)
                    }
                } catch (e: Exception) {
                    log.debug("DropTarget drop failed", e)
                    try {
                        dtde.dropComplete(false)
                    } catch (_: Exception) {
                        // already rejected/completed
                    }
                }
            }
        }
        val targets = linkedSetOf<Component>(this, browser.component)
        runCatching { browser.browserComponent }.getOrNull()?.let { targets.add(it) }
        for (target in targets) {
            try {
                DropTarget(target, DnDConstants.ACTION_COPY, dropListener, true)
            } catch (e: Exception) {
                log.debug("DropTarget install failed on ${target.javaClass.simpleName}", e)
            }
        }
    }

    /**
     * Push current LAF mode to the WebView via [com.github.sandogeek.vibefly.jcef.rpc.Host2Ui.setTheme].
     * When [retry] is true (page load), retries until Host2Ui is registered or attempts run out.
     */
    fun applyTheme(retry: Boolean = false) {
        val mode = VibeflyTheme.currentMode().value
        themeScope.launch {
            val attempts = if (retry) 20 else 1
            repeat(attempts) { attempt ->
                if (disposed) return@launch
                try {
                    uiRpc.host2Ui.setTheme(mode)
                    return@launch
                } catch (e: Exception) {
                    if (attempt == attempts - 1) {
                        log.debug("setTheme($mode) failed", e)
                    } else {
                        delay(150)
                    }
                }
            }
        }
    }

    override fun dispose() {
        disposed = true
        themeScope.cancel()
        // uiRpc + browser disposed via Disposer parent-child link.
    }

    companion object {
        private val log = logger<VibeflyBrowserPanel>()
    }
}
