package com.github.sandogeek.vibefly.jcef

/**
 * Builds the JCEF start URL, optionally appending a hash route.
 *
 * [route] is a hash path without `#` (e.g. `settings`, `settings/providers`).
 * Empty route keeps the base URL unchanged (tool-window chat).
 */
object VibeflyStartUrl {

    fun withRoute(baseUrl: String, route: String = ""): String {
        val base = baseUrl.trim()
        val cleaned = route.trim().trimStart('#', '/')
        if (cleaned.isEmpty()) return base
        val hash = "#/$cleaned"
        val hashIdx = base.indexOf('#')
        val withoutHash = if (hashIdx >= 0) base.substring(0, hashIdx) else base
        return withoutHash + hash
    }
}
