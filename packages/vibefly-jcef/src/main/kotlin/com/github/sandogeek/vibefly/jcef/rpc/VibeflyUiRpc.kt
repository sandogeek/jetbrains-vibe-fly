package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.RpcSession
import com.github.sandogeek.simplerpc.SimpleRpc
import com.github.sandogeek.simplerpc.jcef.CefMessageRouterTransport
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.browser.CefMessageRouter
import org.cef.browser.CefMessageRouter.CefMessageRouterConfig
import org.cef.callback.CefQueryCallback
import org.cef.handler.CefMessageRouterHandlerAdapter

/**
 * Wires SimpleRpc over CefMessageRouter for a [JBCefBrowser].
 *
 * Call [attach] before [JBCefBrowser.loadURL] so `window.cefQuery` is available
 * when the page runs `createCefSimpleRpc`.
 */
class VibeflyUiRpc(
    private val browser: JBCefBrowser,
    hostApi: HostApi = HostApiImpl(),
) : Disposable {

    private val transport = CefMessageRouterTransport { script ->
        val cef = browser.cefBrowser
        val url = cef.url?.takeIf { it.isNotBlank() } ?: "about:blank"
        cef.executeJavaScript(script, url, 0)
    }

    val session: RpcSession = SimpleRpc.open(transport)

    val webApi: WebApi = session.proxy()

    private val router: CefMessageRouter

    init {
        session.register(HostApi::class.java, hostApi)

        val config = CefMessageRouterConfig(
            CefMessageRouterTransport.JS_QUERY_FUNCTION,
            CefMessageRouterTransport.JS_CANCEL_FUNCTION,
        )
        router = CefMessageRouter.create(config)
        router.addHandler(
            object : CefMessageRouterHandlerAdapter() {
                override fun onQuery(
                    browser: CefBrowser?,
                    frame: CefFrame?,
                    queryId: Long,
                    request: String?,
                    persistent: Boolean,
                    callback: CefQueryCallback?,
                ): Boolean {
                    if (request == null || callback == null) return false
                    return transport.handleQuery(
                        queryId,
                        request,
                        onSuccess = { callback.success(it) },
                        onFailure = { code, msg -> callback.failure(code, msg) },
                    )
                }

                override fun onQueryCanceled(
                    browser: CefBrowser?,
                    frame: CefFrame?,
                    queryId: Long,
                ) {
                    transport.handleQueryCanceled(queryId)
                }
            },
            true,
        )
        browser.jbCefClient.cefClient.addMessageRouter(router)
        log.info("SimpleRpc CefMessageRouter attached")
    }

    override fun dispose() {
        try {
            browser.jbCefClient.cefClient.removeMessageRouter(router)
        } catch (e: Exception) {
            log.warn("removeMessageRouter failed", e)
        }
        try {
            router.dispose()
        } catch (e: Exception) {
            log.warn("CefMessageRouter.dispose failed", e)
        }
        session.close()
    }

    companion object {
        private val log = logger<VibeflyUiRpc>()

        /**
         * Attach SimpleRpc to [browser] and register disposal on [parent].
         */
        fun attach(
            browser: JBCefBrowser,
            parent: Disposable,
            hostApi: HostApi = HostApiImpl(),
        ): VibeflyUiRpc {
            val rpc = VibeflyUiRpc(browser, hostApi)
            Disposer.register(parent, rpc)
            return rpc
        }
    }
}
