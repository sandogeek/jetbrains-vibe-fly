package com.github.sandogeek.vibefly.jcef

import com.intellij.ide.ui.LafManager
import com.intellij.ui.JBColor

/**
 * Resolves the current JetBrains LAF into a WebView theme mode.
 *
 * The host only pushes `"dark"` / `"light"` over RPC ([com.github.sandogeek.vibefly.jcef.rpc.Host2Ui.setTheme]);
 * the UI switches `data-jb-theme` and uses tokens defined in styles.css.
 */
object VibeflyTheme {
    const val ATTR: String = "data-jb-theme"

    enum class Mode(val value: String) {
        DARK("dark"),
        LIGHT("light"),
    }

    fun isDarkLaf(): Boolean {
        val theme = LafManager.getInstance().currentUIThemeLookAndFeel
        if (theme != null) return theme.isDark
        return !JBColor.isBright()
    }

    fun currentMode(isDark: Boolean = isDarkLaf()): Mode =
        if (isDark) Mode.DARK else Mode.LIGHT

    fun parseMode(value: String): Mode? =
        Mode.entries.firstOrNull { it.value.equals(value, ignoreCase = true) }
}
