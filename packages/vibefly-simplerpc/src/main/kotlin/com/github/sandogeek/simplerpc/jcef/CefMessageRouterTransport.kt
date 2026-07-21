package com.github.sandogeek.simplerpc.jcef

import com.github.sandogeek.simplerpc.protocol.RpcMessage
import com.github.sandogeek.simplerpc.transport.RpcTransport
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference
import java.util.function.Consumer
import kotlinx.serialization.json.JsonPrimitive

/**
 * [RpcTransport] shaped for IntelliJ JCEF [org.cef.browser.CefMessageRouter].
 *
 * Wire-up (plugin module, where JCEF types are available):
 *
 * ```kotlin
 * val transport = CefMessageRouterTransport { json ->
 *     browser.cefBrowser.executeJavaScript(
 *         CefMessageRouterTransport.deliverToJs(json),
 *         browser.cefBrowser.url,
 *         0,
 *     )
 * }
 * val session = SimpleRpc.open(transport)
 *
 * val config = CefMessageRouterConfig(
 *     CefMessageRouterTransport.JS_QUERY_FUNCTION,
 *     CefMessageRouterTransport.JS_CANCEL_FUNCTION,
 * )
 * val router = CefMessageRouter.create(config)
 * router.addHandler(object : CefMessageRouterHandlerAdapter() {
 *     override fun onQuery(
 *         browser: CefBrowser, frame: CefFrame, queryId: Long,
 *         request: String, persistent: Boolean, callback: CefQueryCallback,
 *     ): Boolean {
 *         return transport.handleQuery(
 *             queryId, request, callback::success, callback::failure,
 *         )
 *     }
 *     override fun onQueryCanceled(
 *         browser: CefBrowser, frame: CefFrame, queryId: Long,
 *     ) {
 *         transport.handleQueryCanceled(queryId)
 *     }
 * }, true)
 * browser.jbCefClient.cefClient.addMessageRouter(router)
 * ```
 *
 * TypeScript side: import `@sandogeek/simple-rpc` and call `createCefSimpleRpc`
 * with `window.cefQuery` / `window.cefQueryCancel`. The page must initialize
 * before Kotlin sends host messages; early events are not buffered.
 *
 * CEF query callbacks stay open until the RPC response is sent (or cancel/failure),
 * so [handleQueryCanceled] can abort the matching inbound request.
 */
class CefMessageRouterTransport(
    private val executeJavaScript: (script: String) -> Unit,
) : RpcTransport {

    private val incoming = AtomicReference<((String) -> Unit)?>(null)

    /**
     * Maps CEF queryId → RPC request id for in-flight TS → Kotlin requests
     * that still hold an open query callback.
     */
    private val queryToRequestId = ConcurrentHashMap<Long, String>()
    private val requestIdToQuery = ConcurrentHashMap<String, Long>()
    private val openCallbacks = ConcurrentHashMap<Long, QueryCallbacks>()

    private data class QueryCallbacks(
        val onSuccess: Consumer<String>,
        val onFailure: (errorCode: Int, errorMessage: String) -> Unit,
    )

    override fun sendToRemote(message: String) {
        // When we deliver a response for a TS-originated request, complete the CEF query.
        tryCompleteQueryForOutbound(message)
        executeJavaScript(deliverToJs(message))
    }

    override fun setIncomingHandler(handler: ((message: String) -> Unit)?) {
        incoming.set(handler)
        if (handler == null) {
            failAllOpenQueries("SimpleRpc closed")
        }
    }

    /**
     * Call from [org.cef.browser.CefMessageRouterHandler.onQuery].
     *
     * For RPC requests the query stays open until [sendToRemote] delivers the response
     * (or [handleQueryCanceled] / failure). For cancel / non-request messages the query
     * is acknowledged immediately.
     *
     * @return true if the request was accepted.
     */
    fun handleQuery(
        queryId: Long,
        request: String,
        onSuccess: Consumer<String>,
        onFailure: (errorCode: Int, errorMessage: String) -> Unit,
    ): Boolean {
        val handler = incoming.get()
        if (handler == null) {
            onFailure(0, "SimpleRpc not ready")
            return true
        }
        return try {
            val parsed = parseWire(request)
            val requestId = (parsed as? RpcMessage.Request)?.id
            val trackQuery = requestId != null && queryId >= 0
            if (trackQuery) {
                openCallbacks[queryId] = QueryCallbacks(onSuccess, onFailure)
                queryToRequestId[queryId] = requestId
                requestIdToQuery[requestId] = queryId
            } else {
                // Wire cancel without cefQueryCancel: close the held native callback
                // so the original TS→Kotlin req query does not leak.
                val cancelRequestId = (parsed as? RpcMessage.Cancel)?.id
                if (cancelRequestId != null) {
                    completeOpenQueryAsCancelled(cancelRequestId)
                }
            }
            handler(request)
            if (!trackQuery) {
                // cancel / response / legacy: ack receipt only
                onSuccess.accept("")
            }
            true
        } catch (e: Exception) {
            if (queryId >= 0) {
                clearQuery(queryId)
            }
            onFailure(0, e.message ?: "SimpleRpc error")
            true
        }
    }

    /**
     * Legacy overload without queryId: always acknowledges immediately
     * (cefQueryCancel cannot be correlated). Prefer the queryId overload.
     */
    fun handleQuery(
        request: String,
        onSuccess: Consumer<String>,
        onFailure: (errorCode: Int, errorMessage: String) -> Unit,
    ): Boolean = handleQuery(
        queryId = -1L,
        request = request,
        onSuccess = onSuccess,
        onFailure = onFailure,
    )

    /**
     * Call from [org.cef.browser.CefMessageRouterHandler.onQueryCanceled].
     * Injects a wire cancel so [com.github.sandogeek.simplerpc.RpcSession] aborts the Job.
     */
    fun handleQueryCanceled(queryId: Long) {
        val requestId = queryToRequestId.remove(queryId)
        if (requestId != null) {
            requestIdToQuery.remove(requestId)
            openCallbacks.remove(queryId)
            incoming.get()?.invoke(RpcMessage.Cancel(requestId).toJson())
        } else {
            openCallbacks.remove(queryId)
        }
    }

    private fun tryCompleteQueryForOutbound(message: String) {
        val msg = parseWire(message) ?: return
        val queryId = requestIdToQuery.remove(msg.id) ?: return
        queryToRequestId.remove(queryId)
        val cb = openCallbacks.remove(queryId) ?: return
        when (msg) {
            is RpcMessage.Cancel -> cb.onFailure(1, "cancelled")
            else -> cb.onSuccess.accept("")
        }
    }

    private fun parseWire(raw: String): RpcMessage? =
        try {
            RpcMessage.parse(raw)
        } catch (_: Exception) {
            null
        }

    /**
     * Completes a held CEF query for [requestId] after a wire cancel was received.
     * Prefer [handleQueryCanceled] when the page used cefQueryCancel; this path
     * covers wire-only cancel so the native query does not stay open.
     */
    private fun completeOpenQueryAsCancelled(requestId: String) {
        val openQueryId = requestIdToQuery.remove(requestId) ?: return
        queryToRequestId.remove(openQueryId)
        val cb = openCallbacks.remove(openQueryId) ?: return
        try {
            cb.onFailure(1, "cancelled")
        } catch (_: Exception) {
        }
    }

    private fun clearQuery(queryId: Long) {
        val requestId = queryToRequestId.remove(queryId)
        if (requestId != null) {
            requestIdToQuery.remove(requestId)
        }
        openCallbacks.remove(queryId)
    }

    private fun failAllOpenQueries(msg: String) {
        val ids = openCallbacks.keys.toList()
        for (queryId in ids) {
            val cb = openCallbacks.remove(queryId) ?: continue
            try {
                cb.onFailure(0, msg)
            } catch (_: Exception) {
            }
            clearQuery(queryId)
        }
        queryToRequestId.clear()
        requestIdToQuery.clear()
    }

    companion object {
        /** JS function name registered with CefMessageRouterConfig (TS → Kotlin). */
        const val JS_QUERY_FUNCTION = "cefQuery"

        /** Cancel function name for CefMessageRouterConfig. */
        const val JS_CANCEL_FUNCTION = "cefQueryCancel"

        /**
         * Fixed DOM CustomEvent type used to push host → page RPC messages.
         * The ESM transport subscribes with `window.addEventListener(HOST_MESSAGE_EVENT, ...)`.
         */
        const val HOST_MESSAGE_EVENT = "simplerpc:host-message"

        /**
         * Builds a script that dispatches [json] as a [HOST_MESSAGE_EVENT] CustomEvent.
         *
         * Encodes [json] as a JSON string literal (JSON.stringify semantics) so the full
         * standard escape table is used instead of a hand-maintained replace list.
         * U+2028/U+2029 are extra-escaped because they are JS line terminators.
         * The page transport reads `event.detail` (already a string wire envelope).
         */
        fun deliverToJs(json: String): String {
            val encoded = JsonPrimitive(json).toString()
                .replace("\u2028", "\\u2028")
                .replace("\u2029", "\\u2029")
            return "window.dispatchEvent(new CustomEvent(\"$HOST_MESSAGE_EVENT\"," +
                "{detail:$encoded}));"
        }
    }
}
