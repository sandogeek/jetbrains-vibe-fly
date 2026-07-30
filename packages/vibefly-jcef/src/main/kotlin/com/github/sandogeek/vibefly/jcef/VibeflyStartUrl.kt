package com.github.sandogeek.vibefly.jcef

import java.net.URLEncoder
import java.nio.charset.StandardCharsets

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

    /** Adds a query parameter before the hash fragment, preserving both existing query and route. */
    fun withQueryParameter(baseUrl: String, name: String, value: String): String {
        val base = baseUrl.trim()
        val hashIdx = base.indexOf('#')
        val page = if (hashIdx >= 0) base.substring(0, hashIdx) else base
        val hash = if (hashIdx >= 0) base.substring(hashIdx) else ""
        val separator = when {
            '?' !in page -> "?"
            page.endsWith('?') || page.endsWith('&') -> ""
            else -> "&"
        }
        val encodedName = URLEncoder.encode(name, StandardCharsets.UTF_8)
        val encodedValue = URLEncoder.encode(value, StandardCharsets.UTF_8)
        return "$page$separator$encodedName=$encodedValue$hash"
    }
}
