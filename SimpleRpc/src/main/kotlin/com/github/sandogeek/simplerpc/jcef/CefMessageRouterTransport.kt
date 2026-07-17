package com.github.sandogeek.simplerpc.jcef

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
 * TypeScript side: load [JS_BRIDGE_SOURCE] before app code, then use `window.SimpleRpc`.
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
            val requestId = extractRequestIdIfReq(request)
            val trackQuery = requestId != null && queryId >= 0
            if (trackQuery) {
                openCallbacks[queryId] = QueryCallbacks(onSuccess, onFailure)
                queryToRequestId[queryId] = requestId
                requestIdToQuery[requestId] = queryId
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
            incoming.get()?.invoke("""{"t":"cancel","id":"$requestId"}""")
        } else {
            openCallbacks.remove(queryId)
        }
    }

    private fun tryCompleteQueryForOutbound(message: String) {
        val kind = messageKind(message) ?: return
        val requestId = extractId(message) ?: return
        val queryId = requestIdToQuery.remove(requestId) ?: return
        queryToRequestId.remove(queryId)
        val cb = openCallbacks.remove(queryId) ?: return
        when (kind) {
            "cancel" -> cb.onFailure(1, "cancelled")
            else -> cb.onSuccess.accept("")
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

        /** Global used by Kotlin executeJavaScript to push messages into the page. */
        const val JS_INBOUND_FUNCTION = "__simpleRpcOnHostMessage"

        /**
         * Builds a script that delivers [json] to the page-side bridge.
         *
         * Encodes [json] as a JSON string literal (JSON.stringify semantics) so the full
         * standard escape table is used instead of a hand-maintained replace list.
         * U+2028/U+2029 are extra-escaped because they are JS line terminators.
         * The page bridge [JSON.parse]s the string argument.
         */
        fun deliverToJs(json: String): String {
            val encoded = JsonPrimitive(json).toString()
                .replace("\u2028", "\\u2028")
                .replace("\u2029", "\\u2029")
            return "window.$JS_INBOUND_FUNCTION && window.$JS_INBOUND_FUNCTION($encoded);"
        }

        private fun messageKind(raw: String): String? {
            return when {
                raw.contains("\"t\":\"req\"") || raw.contains("\"t\": \"req\"") -> "req"
                raw.contains("\"t\":\"ok\"") || raw.contains("\"t\": \"ok\"") -> "ok"
                raw.contains("\"t\":\"err\"") || raw.contains("\"t\": \"err\"") -> "err"
                raw.contains("\"t\":\"cancel\"") || raw.contains("\"t\": \"cancel\"") -> "cancel"
                else -> null
            }
        }

        private fun extractRequestIdIfReq(raw: String): String? {
            if (messageKind(raw) != "req") return null
            return extractId(raw)
        }

        private fun extractId(raw: String): String? {
            val key = "\"id\""
            val idx = raw.indexOf(key)
            if (idx < 0) return null
            val colon = raw.indexOf(':', idx + key.length)
            if (colon < 0) return null
            val startQuote = raw.indexOf('"', colon + 1)
            if (startQuote < 0) return null
            val endQuote = raw.indexOf('"', startQuote + 1)
            if (endQuote < 0) return null
            return raw.substring(startQuote + 1, endQuote)
        }

        /**
         * Minimal TypeScript/JavaScript bridge to inject into the WebView (or bundle).
         * Depends on CEF injecting [JS_QUERY_FUNCTION] via CefMessageRouter.
         *
         * Supports request timeout (default 30s), AbortSignal / cancel(), and peer cancel.
         */
        val JS_BRIDGE_SOURCE: String = """
            (function () {
              if (window.SimpleRpc) return;
              var pending = {};
              var handlers = {};
              var inflight = {};
              var DEFAULT_TIMEOUT_MS = 30000;
              var requestSequence = 0;
              var requestIdPrefix =
                'j:' + Date.now().toString(36) + ':' +
                Math.random().toString(36).slice(2) + ':';

              function parse(msg) {
                return typeof msg === 'string' ? JSON.parse(msg) : msg;
              }

              function send(obj) {
                var json = JSON.stringify(obj);
                if (typeof window.$JS_QUERY_FUNCTION !== 'function') {
                  throw new Error('CefMessageRouter not ready ($JS_QUERY_FUNCTION missing)');
                }
                var requestId = obj && obj.id;
                var queryId = window.$JS_QUERY_FUNCTION({
                  request: json,
                  persistent: false,
                  onSuccess: function () {},
                  onFailure: function (code, msg) {
                    if (obj.t !== 'req') return;
                    var p = pending[requestId];
                    if (p) {
                      delete pending[requestId];
                      if (p.timer) clearTimeout(p.timer);
                      p.reject(new Error(msg || ('query failed ' + code)));
                    }
                  }
                });
                if (requestId && obj.t === 'req' && queryId != null) {
                  var p = pending[requestId];
                  if (p) p.queryId = queryId;
                }
                return queryId;
              }

              function sendCancel(requestId) {
                try {
                  send({ t: 'cancel', id: requestId });
                } catch (e) {}
                var p = pending[requestId];
                if (p && p.queryId != null && typeof window.$JS_CANCEL_FUNCTION === 'function') {
                  try { window.$JS_CANCEL_FUNCTION(p.queryId); } catch (e) {}
                }
              }

              function settleReject(requestId, err) {
                var p = pending[requestId];
                if (!p) return;
                delete pending[requestId];
                if (p.timer) clearTimeout(p.timer);
                p.reject(err);
              }

              window.$JS_INBOUND_FUNCTION = function (raw) {
                var msg = parse(raw);
                if (msg.t === 'ok') {
                  var p = pending[msg.id];
                  if (!p) return;
                  delete pending[msg.id];
                  if (p.timer) clearTimeout(p.timer);
                  p.resolve(msg.r);
                  return;
                }
                if (msg.t === 'err') {
                  var pErr = pending[msg.id];
                  if (!pErr) return;
                  delete pending[msg.id];
                  if (pErr.timer) clearTimeout(pErr.timer);
                  pErr.reject(new Error(msg.e || 'RPC failed'));
                  return;
                }
                if (msg.t === 'cancel') {
                  var c = inflight[msg.id];
                  if (c && c.abort) c.abort();
                  delete inflight[msg.id];
                  settleReject(msg.id, new Error('RPC cancelled'));
                  return;
                }
                if (msg.t === 'req') {
                  var key = msg.s + '#' + msg.i;
                  var fn = handlers[key];
                  var aborted = false;
                  var controller = {
                    aborted: false,
                    abort: function () {
                      this.aborted = true;
                      aborted = true;
                    }
                  };
                  inflight[msg.id] = controller;
                  Promise.resolve()
                    .then(function () {
                      if (aborted) throw new Error('RPC cancelled');
                      if (msg.i == null || msg.i === undefined) {
                        throw new Error('Missing method id for ' + msg.s);
                      }
                      if (!fn) throw new Error('Unknown method ' + key);
                      return fn.apply(null, msg.a || []);
                    })
                    .then(function (result) {
                      delete inflight[msg.id];
                      if (aborted) return;
                      send({ t: 'ok', id: msg.id, r: result === undefined ? null : result });
                    })
                    .catch(function (err) {
                      delete inflight[msg.id];
                      if (aborted) return;
                      send({ t: 'err', id: msg.id, e: (err && err.message) || String(err) });
                    });
                }
              };

              function nextRequestId() {
                requestSequence += 1;
                return requestIdPrefix + requestSequence.toString(36);
              }

              window.SimpleRpc = {
                /**
                 * Register a TS implementation method for Kotlin → TS calls.
                 * methodId maps to wire field `i` (@RpcFun id).
                 */
                register: function (service, methodId, fn) {
                  handlers[service + '#' + methodId] = fn;
                },
                /**
                 * Call a Kotlin @TsCallKotlin method by methodId (wire field `i`).
                 * opts: { timeoutMs?: number, signal?: AbortSignal }
                 * Returns a Promise with .cancel() to abort the in-flight call.
                 */
                call: function (service, methodId, args, opts) {
                  opts = opts || {};
                  var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
                  var requestId = nextRequestId();
                  var promise = new Promise(function (resolve, reject) {
                    var entry = { resolve: resolve, reject: reject, timer: null, queryId: null };
                    pending[requestId] = entry;
                    if (timeoutMs > 0 && isFinite(timeoutMs)) {
                      entry.timer = setTimeout(function () {
                        if (!pending[requestId]) return;
                        sendCancel(requestId);
                        settleReject(requestId, new Error('RPC timed out after ' + timeoutMs + 'ms'));
                      }, timeoutMs);
                    }
                    if (opts.signal) {
                      if (opts.signal.aborted) {
                        sendCancel(requestId);
                        settleReject(requestId, new Error('RPC cancelled'));
                        return;
                      }
                      opts.signal.addEventListener('abort', function () {
                        if (!pending[requestId]) return;
                        sendCancel(requestId);
                        settleReject(requestId, new Error('RPC cancelled'));
                      });
                    }
                    try {
                      send({ t: 'req', id: requestId, s: service, i: methodId, a: args || [] });
                    } catch (e) {
                      settleReject(requestId, e);
                    }
                  });
                  promise.cancel = function () {
                    if (!pending[requestId]) return;
                    sendCancel(requestId);
                    settleReject(requestId, new Error('RPC cancelled'));
                  };
                  return promise;
                }
              };
            })();
        """.trimIndent()
    }
}
