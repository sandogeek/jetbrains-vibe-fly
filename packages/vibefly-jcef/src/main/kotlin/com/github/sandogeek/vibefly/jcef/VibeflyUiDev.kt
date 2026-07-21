package com.github.sandogeek.vibefly.jcef

/**
 * Dev-mode entry for Vite HMR inside JCEF.
 *
 * Production loads [VibeflyScheme.INDEX_URL] from classpath.
 * Dev loads the Vite server so WebSocket HMR works (classpath scheme cannot proxy WS).
 *
 * Enable:
 * - `-Dvibefly.ui.dev=true` → [DEFAULT_DEV_URL]
 * - `-Dvibefly.ui.dev.url=http://127.0.0.1:5173/` → custom URL
 */
object VibeflyUiDev {
    const val DEV_ENABLED_PROPERTY: String = "vibefly.ui.dev"
    const val DEV_URL_PROPERTY: String = "vibefly.ui.dev.url"
    const val DEFAULT_DEV_URL: String = "http://127.0.0.1:5173/"

    fun isEnabled(
        properties: (String) -> String? = System::getProperty,
    ): Boolean {
        if (!properties(DEV_URL_PROPERTY).isNullOrBlank()) return true
        return properties(DEV_ENABLED_PROPERTY)?.toBooleanStrictOrNull() == true
    }

    fun resolveStartUrl(
        properties: (String) -> String? = System::getProperty,
    ): String {
        properties(DEV_URL_PROPERTY)?.trim()?.takeIf { it.isNotEmpty() }?.let { return normalizeUrl(it) }
        if (properties(DEV_ENABLED_PROPERTY)?.toBooleanStrictOrNull() == true) {
            return DEFAULT_DEV_URL
        }
        return VibeflyScheme.INDEX_URL
    }

    private fun normalizeUrl(url: String): String =
        if (url.endsWith("/")) url else "$url/"
}
