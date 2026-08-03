package com.github.sandogeek.jetbrainsvibefly.agent

import com.intellij.openapi.application.ApplicationInfo
import java.nio.file.Path

/**
 * Product-local pi agent directory (models.json, auth.json, sessions).
 *
 * Fixed path: `~/.vibefly/<productCode>/agent` (productCode lowercased, e.g. iu/cl/rd).
 * Not user-configurable — IDEA / CLion / Rider do not share state.
 */
object VibeflyAgentDirectory {

    fun current(): String = resolve(productCode()).toString()

    fun resolve(productCode: String): Path {
        var code = productCode.trim().lowercase().ifEmpty { FALLBACK_PRODUCT }
        if (code == "ic") {
            code = "iu"
        }
        val home = System.getProperty("user.home") ?: ""
        return Path.of(home, ROOT_DIR, code, AGENT_DIR).normalize()
    }

    fun productCode(): String {
        return try {
            ApplicationInfo.getInstance().build.productCode
                .trim()
                .lowercase()
                .ifEmpty { FALLBACK_PRODUCT }
        } catch (_: Throwable) {
            FALLBACK_PRODUCT
        }
    }

    private const val ROOT_DIR = ".vibefly"
    private const val AGENT_DIR = "agent"
    private const val FALLBACK_PRODUCT = "unknown"
}
