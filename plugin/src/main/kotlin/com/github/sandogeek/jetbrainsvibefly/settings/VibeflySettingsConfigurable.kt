package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.vibefly.jcef.VibeflyBrowserPanel
import com.intellij.openapi.Disposable
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.ui.jcef.JBCefApp
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Single IDE Settings node: Tools → Vibe Fly.
 * Hosts the Solid settings app in JCEF with write-through RPC (no Apply draft).
 */
class VibeflySettingsConfigurable : SearchableConfigurable, Configurable.NoScroll {
    private var panel: JComponent? = null
    private var browserPanel: VibeflyBrowserPanel? = null
    private var uiDisposable: Disposable? = null

    override fun getId(): String = "vibefly.settings"

    override fun getDisplayName(): String = VibeflyBundle.message("settings.vibefly")

    override fun createComponent(): JComponent {
        val existing = panel
        if (existing != null) return existing

        if (!JBCefApp.isSupported()) {
            val fallback = JPanel(BorderLayout()).apply {
                border = JBUI.Borders.empty(12)
                add(
                    JBLabel("JCEF is not supported in this runtime. Vibe Fly settings require JCEF."),
                    BorderLayout.NORTH,
                )
            }
            panel = fallback
            return fallback
        }

        val disposable = Disposer.newDisposable("VibeflySettingsConfigurable")
        uiDisposable = disposable
        lateinit var host: SettingsUi2Host
        host = SettingsUi2Host(
            host2UiProvider = { browserPanel?.rpc?.host2Ui },
        )
        val browser = VibeflyBrowserPanel(host, route = "settings")
        browserPanel = browser
        Disposer.register(disposable, browser)
        panel = browser
        return browser
    }

    /** Write-through via RPC; Settings Apply/Cancel do not manage drafts. */
    override fun isModified(): Boolean = false

    override fun apply() {}

    override fun reset() {}

    override fun disposeUIResources() {
        val disposable = uiDisposable
        uiDisposable = null
        browserPanel = null
        panel = null
        if (disposable != null) {
            Disposer.dispose(disposable)
        }
    }
}
