package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.RpcSession
import com.github.sandogeek.simplerpc.SimpleRpc
import com.github.sandogeek.simplerpc.jcef.CefMessageRouterTransport
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.browser.CefMessageRouter
import org.cef.browser.CefMessageRouter.CefMessageRouterConfig
import org.cef.callback.CefQueryCallback
import org.cef.handler.CefMessageRouterHandlerAdapter
import java.util.concurrent.atomic.AtomicLong

/**
 * Wires SimpleRpc over CefMessageRouter for a [JBCefBrowser].
 *
 * Call [attach] before [JBCefBrowser.loadURL]. Each panel uses a unique native query
 * function name to avoid multi-panel MessageRouter collisions. The panel puts
 * [channelId] in its start URL so the page binds the exact pair of functions.
 */
class VibeflyUiRpc(
    private val browser: JBCefBrowser,
    ui2Host: Ui2Host = Ui2HostImpl(),
) : Disposable {

    private val transport = CefMessageRouterTransport { script ->
        val cef = browser.cefBrowser
        val url = cef.url?.takeIf { it.isNotBlank() } ?: "about:blank"
        cef.executeJavaScript(script, url, 0)
    }

    val session: RpcSession = SimpleRpc.open(transport)

    val host2Ui: Host2Ui = session.proxy()

    private val router: CefMessageRouter

    /** Identifies this panel's exact CEF query-function pair to the page. */
    val channelId: String = ROUTER_SEQUENCE.incrementAndGet().toString()

    /** Unique CEF-injected names for this panel (avoids cefQuery collisions). */
    private val queryFunction: String = "vibeflyCefQuery_$channelId"
    private val cancelFunction: String = "vibeflyCefQueryCancel_$channelId"
    private val ownedBrowser: CefBrowser = browser.cefBrowser

    init {
        session.register(Ui2Host::class.java, ui2Host)

        val config = CefMessageRouterConfig(queryFunction, cancelFunction)
        // JBCefApp delegates router creation to the remote JCEF implementation when
        // out-of-process mode is enabled; locally it falls back to CefMessageRouter.create.
        router = JBCefApp.getInstance().createMessageRouter(config)
        // MessageRouters on a shared / remote CEF stack can see every browser's queries.
        // Only accept this panel's browser; return false so the correct router can handle it.
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
                    if (browser != ownedBrowser) {
                        log.error("queryFunction cancelFunction名字一致的情况下onQuery可能串台，改为唯一后不应该出现此问题 ${browser} ${ownedBrowser}")
                        return false
                    }
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
                    if (browser != ownedBrowser) return
                    transport.handleQueryCanceled(queryId)
                }
            },
            true,
        )
        browser.jbCefClient.cefClient.addMessageRouter(router)
        log.info(
            "SimpleRpc CefMessageRouter attached host=${ui2Host.javaClass.name} " +
                "queryFn=$queryFunction",
        )
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
        private val ROUTER_SEQUENCE = AtomicLong()
        const val CHANNEL_QUERY_PARAMETER: String = "vibeflyRpcChannel"

        /**
         * Attach SimpleRpc to [browser] and register disposal on [parent].
         */
        fun attach(
            browser: JBCefBrowser,
            parent: Disposable,
            ui2Host: Ui2Host = Ui2HostImpl(),
        ): VibeflyUiRpc {
            val rpc = VibeflyUiRpc(browser, ui2Host)
            Disposer.register(parent, rpc)
            return rpc
        }
    }
}
