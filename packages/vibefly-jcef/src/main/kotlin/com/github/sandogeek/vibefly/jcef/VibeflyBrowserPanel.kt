package com.github.sandogeek.vibefly.jcef

import com.github.sandogeek.vibefly.jcef.rpc.Ui2Host
import com.github.sandogeek.vibefly.jcef.rpc.Ui2HostImpl
import com.github.sandogeek.vibefly.jcef.rpc.VibeflyUiRpc
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.ui.UIUtil
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.awt.BorderLayout
import javax.swing.JPanel

/**
 * Tool-window host for the vibefly JCEF UI.
 *
 * Production: [VibeflyScheme.INDEX_URL] via classpath.
 * Dev (Vite HMR): [VibeflyUiDev] → e.g. `http://127.0.0.1:5173/`.
 *
 * Dark/light tokens follow the current JetBrains LAF ([VibeflyTheme]).
 * WebView ↔ Kotlin: SimpleRpc over CefMessageRouter ([VibeflyUiRpc]).
 */
class VibeflyBrowserPanel(
    ui2Host: Ui2Host = Ui2HostImpl(),
) : JPanel(BorderLayout()), Disposable {

    private val browser: JBCefBrowser
    private val uiRpc: VibeflyUiRpc

    @Volatile
    private var disposed: Boolean = false

    init {
        // Always register so absolute http://vibefly/ assets still work if referenced.
        VibeflyScheme.ensureRegistered()
        val startUrl = VibeflyUiDev.resolveStartUrl()
        if (VibeflyUiDev.isEnabled()) {
            log.info("Vibefly UI dev (Vite HMR): $startUrl")
        }
        background = UIUtil.getPanelBackground()
        isOpaque = true
        browser = JBCefBrowser.createBuilder()
            .setOffScreenRendering(false)
            .build()
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
                    applyTheme()
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
                    applyTheme()
                },
            )

        // Theme is applied in onLoadEnd (document ready); skip pre-load JS no-op.
        browser.loadURL(startUrl)
    }

    val jbCefBrowser: JBCefBrowser
        get() = browser

    /** SimpleRpc session for this panel (Ui2Host registered; [host2Ui] proxies into the page). */
    val rpc: VibeflyUiRpc
        get() = uiRpc

    private fun applyTheme() {
        // Resolve tokens on the later EDT pass so UIManager colors match the new LAF
        // (listener can fire while named colors are still settling).
        // executeJavaScript must run on EDT; any() keeps LAF updates working under modals.
        ApplicationManager.getApplication().invokeLater(
            {
                if (disposed) return@invokeLater
                val script = VibeflyTheme.applyScript()
                val cef = browser.cefBrowser
                val url = cef.url?.takeIf { it.isNotBlank() } ?: VibeflyScheme.INDEX_URL
                cef.executeJavaScript(script, url, 0)
            },
            ModalityState.any(),
        )
    }

    override fun dispose() {
        disposed = true
        // uiRpc + browser disposed via Disposer parent-child link.
    }

    companion object {
        private val log = logger<VibeflyBrowserPanel>()
    }
}
