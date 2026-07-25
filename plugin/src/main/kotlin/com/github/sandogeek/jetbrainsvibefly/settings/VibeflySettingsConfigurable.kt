package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import javax.swing.JComponent
import javax.swing.JPanel
import java.awt.BorderLayout

/**
 * Parent Settings node: Vibe Fly.
 * Children (e.g. Providers) are registered under this id in plugin.xml.
 */
class VibeflySettingsConfigurable : SearchableConfigurable, Configurable.NoScroll {
    private var panel: JPanel? = null

    override fun getId(): String = "vibefly.settings"

    override fun getDisplayName(): String = VibeflyBundle.message("settings.vibefly")

    override fun createComponent(): JComponent {
        if (panel == null) {
            panel = JPanel(BorderLayout()).apply {
                border = JBUI.Borders.empty(12)
                add(
                    JBLabel(VibeflyBundle.message("settings.vibefly.description")),
                    BorderLayout.NORTH,
                )
            }
        }
        return panel!!
    }

    override fun isModified(): Boolean = false

    override fun apply() {}

    override fun reset() {}

    override fun disposeUIResources() {
        panel = null
    }
}
