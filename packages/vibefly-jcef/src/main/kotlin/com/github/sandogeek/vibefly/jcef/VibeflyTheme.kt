package com.github.sandogeek.vibefly.jcef

import com.intellij.ide.ui.LafManager
import com.intellij.ui.ColorUtil
import com.intellij.ui.JBColor
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Color
import javax.swing.UIManager

/**
 * Maps the current JetBrains LAF into the WebView document.
 *
 * Sets [ATTR] / `color-scheme` from dark/light, and injects live LAF colors as
 * `--vf-*` (and mirrored `--color-*`) via a dedicated `<style>` tag so Tailwind
 * utilities track custom themes, High Contrast, and user palette overrides
 * without losing to `@layer theme` defaults.
 */
object VibeflyTheme {
    const val ATTR: String = "data-jb-theme"
    const val STYLE_ID: String = "vibefly-ide-theme"

    /** CSS custom properties owned by the IDE inject path (see styles.css). */
    private val TOKEN_KEYS = listOf(
        "fg",
        "muted",
        "bg",
        "accent",
        "surface",
        "border",
    )

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

    /**
     * Resolve token colors from the active LAF (not hardcoded hex tables).
     * Keys are short names (`bg`, `fg`, …); [applyScript] expands them to CSS vars.
     */
    fun resolveTokens(): Map<String, String> {
        val bg = UIUtil.getPanelBackground()
        val fg = UIUtil.getLabelForeground()
        val muted = UIUtil.getContextHelpForeground()
        val border = UIManager.getColor("Component.borderColor")
            ?: UIManager.getColor("Separator.separatorColor")
            ?: UIUtil.getBoundsColor()
        val accent = UIManager.getColor("Hyperlink.linkColor")
            ?: JBUI.CurrentTheme.Link.Foreground.ENABLED
        val surface = UIUtil.getListBackground()

        return mapOf(
            "fg" to toCssHex(fg),
            "muted" to toCssHex(muted),
            "bg" to toCssHex(bg),
            "accent" to toCssHex(accent),
            "surface" to toCssHex(surface),
            "border" to toCssHex(border),
        )
    }

    /**
     * JS applied after each page load and on LAF change.
     * Idempotent; safe to re-run.
     *
     * Uses a dedicated unlayered `<style>` block so overrides beat Tailwind's
     * `@layer theme` defaults. Also mirrors onto `--color-*` and forces
     * `html`/`body` paint colors so the shell cannot lag behind tokens.
     */
    fun applyScript(
        mode: Mode = currentMode(),
        tokens: Map<String, String> = resolveTokens(),
    ): String {
        val value = mode.value
        val resolved = TOKEN_KEYS.associateWith { key ->
            tokens[key] ?: tokens["--color-$key"] ?: tokens["--vf-$key"] ?: "#000000"
        }
        val decls = resolved.entries.joinToString("") { (key, color) ->
            "--vf-$key:$color;--color-$key:$color;"
        }
        val bg = resolved.getValue("bg")
        val fg = resolved.getValue("fg")
        // Escape for embedding inside a JS single-quoted string / CSS textContent.
        val themeSelector = "html[$ATTR=\"$value\"]"
        val css = ":root{color-scheme:$value;$decls}" +
            "$themeSelector{color-scheme:$value;$decls}" +
            "html,body,#root{background-color:$bg;color:$fg;}"

        return """
            (function () {
              var root = document.documentElement;
              if (!root) return;
              root.setAttribute("$ATTR", "$value");
              root.style.colorScheme = "$value";
              var css = '$css';
              var style = document.getElementById("$STYLE_ID");
              if (!style) {
                style = document.createElement("style");
                style.id = "$STYLE_ID";
                (document.head || root).appendChild(style);
              }
              style.textContent = css;
            })();
        """.trimIndent()
    }

    /** `#rrggbb`, or `#rrggbbaa` when alpha &lt; 255. */
    fun toCssHex(color: Color): String =
        if (color.alpha < 255) {
            "#${ColorUtil.toHex(color, true)}"
        } else {
            ColorUtil.toHtmlColor(color)
        }
}
