package com.github.sandogeek.vibefly.jcef

import java.net.URI

/**
 * Normalize a panel start URL into an Origin used for Agent WebSocket tickets:
 * `scheme + host + effective port` only (default 80/443 omitted).
 */
object AgentOrigin {
    fun fromStartUrl(startUrl: String): String {
        val uri = URI(startUrl.trim())
        val scheme = uri.scheme?.lowercase()
            ?: error("Agent origin requires an absolute URL with scheme: $startUrl")
        val host = uri.host?.takeIf { it.isNotBlank() }
            ?: error("Agent origin requires a host: $startUrl")
        val port = uri.port
        val defaultPort = when (scheme) {
            "http" -> 80
            "https" -> 443
            else -> -1
        }
        return if (port == -1 || port == defaultPort) {
            "$scheme://$host"
        } else {
            "$scheme://$host:$port"
        }
    }

    /** Production classpath UI origin from [VibeflyScheme.INDEX_URL]. */
    fun production(): String = fromStartUrl(VibeflyScheme.INDEX_URL)

    /** Current panel origin (dev Vite or production scheme). */
    fun currentPanel(): String = fromStartUrl(VibeflyUiDev.resolveStartUrl())
}
