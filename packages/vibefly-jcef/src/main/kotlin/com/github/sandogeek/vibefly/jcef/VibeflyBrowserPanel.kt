package com.github.sandogeek.vibefly.jcef

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import java.awt.BorderLayout
import javax.swing.JPanel

/**
 * Tool-window host for the vibefly JCEF UI.
 *
 * Production: [VibeflyScheme.INDEX_URL] via classpath.
 * Dev (Vite HMR): [VibeflyUiDev] → e.g. `http://127.0.0.1:5173/`.
 */
class VibeflyBrowserPanel : JPanel(BorderLayout()), Disposable {

    private val browser: JBCefBrowser

    init {
        // Always register so absolute http://vibefly/ assets still work if referenced.
        VibeflyScheme.ensureRegistered()
        val startUrl = VibeflyUiDev.resolveStartUrl()
        if (VibeflyUiDev.isEnabled()) {
            log.info("Vibefly UI dev (Vite HMR): $startUrl")
        }
        browser = JBCefBrowser.createBuilder()
            .setOffScreenRendering(false)
            .build()
        add(browser.component, BorderLayout.CENTER)
        Disposer.register(this, browser)
        browser.loadURL(startUrl)
    }

    val jbCefBrowser: JBCefBrowser
        get() = browser

    override fun dispose() {
        // Browser disposed via Disposer parent-child link.
    }

    companion object {
        private val log = logger<VibeflyBrowserPanel>()
    }
}
