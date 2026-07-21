package com.github.sandogeek.vibefly.jcef

import com.intellij.openapi.diagnostic.logger
import com.intellij.ui.jcef.JBCefApp
import org.cef.CefApp
import org.cef.callback.CefSchemeHandlerFactory

/**
 * Registers http://vibefly/... to classpath web/ via [ClasspathResourceHandler].
 *
 * Call [ensureRegistered] before creating a browser and loading [INDEX_URL].
 */
object VibeflyScheme {
    const val SCHEME: String = "http"
    const val DOMAIN: String = "vibefly"
    const val INDEX_URL: String = "$SCHEME://$DOMAIN/index.html"

    private const val RESOURCE_BASE: String = "web"

    private val log = logger<VibeflyScheme>()
    private val lock = Any()

    @Volatile
    private var registered: Boolean = false

    fun ensureRegistered(
        classLoader: ClassLoader = VibeflyScheme::class.java.classLoader,
    ) {
        if (registered) return
        synchronized(lock) {
            if (registered) return
            check(JBCefApp.isSupported()) {
                "JCEF is not supported in this runtime"
            }
            // Ensure CEF is started so CefApp.getInstance() is valid.
            JBCefApp.getInstance()
            val ok = CefApp.getInstance().registerSchemeHandlerFactory(
                SCHEME,
                DOMAIN,
                CefSchemeHandlerFactory { _, _, _, _ ->
                    ClasspathResourceHandler(
                        basePath = RESOURCE_BASE,
                        classLoader = classLoader,
                    )
                },
            )
            if (!ok) {
                log.warn("Failed to register scheme handler for $SCHEME://$DOMAIN")
            } else {
                log.info("Registered classpath scheme handler: $SCHEME://$DOMAIN -> /$RESOURCE_BASE")
            }
            registered = true
        }
    }
}
