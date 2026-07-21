package com.github.sandogeek.vibefly.jcef

import org.cef.callback.CefCallback
import org.cef.handler.CefResourceHandlerAdapter
import org.cef.misc.IntRef
import org.cef.misc.StringRef
import org.cef.network.CefRequest
import org.cef.network.CefResponse
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.URI

/**
 * Serves classpath resources for a custom http domain (e.g. http://vibefly/...).
 *
 * Jar-packaged CSS/JS have no real filesystem path; this handler streams them via
 * [ClassLoader.getResourceAsStream] so the WebView can load multi-chunk Vite output.
 *
 * Note: CefResponse.mimeType must be a bare type (no charset). Charset goes in Content-Type.
 */
class ClasspathResourceHandler(
    private val basePath: String = "web",
    private val classLoader: ClassLoader = ClasspathResourceHandler::class.java.classLoader,
) : CefResourceHandlerAdapter() {

    private var stream: InputStream? = null
    private var mimeType: String = "application/octet-stream"
    private var contentType: String? = null
    private var contentLength: Int = 0
    private var status: Int = 404

    override fun processRequest(request: CefRequest, callback: CefCallback): Boolean {
        openResource(request.url)
        callback.Continue()
        return true
    }

    override fun getResponseHeaders(
        response: CefResponse,
        responseLength: IntRef,
        redirectUrl: StringRef,
    ) {
        response.status = status
        response.statusText = if (status == 200) "OK" else "Not Found"
        // Bare MIME only — charset parameters break CEF HTML rendering (shows source as text).
        response.mimeType = mimeType
        contentType?.let { response.setHeaderByName("Content-Type", it, true) }
        response.setHeaderByName("Access-Control-Allow-Origin", "*", true)
        if (status == 200) {
            response.setHeaderByName("Cache-Control", "private, max-age=3600", true)
            responseLength.set(contentLength)
        } else {
            responseLength.set(0)
        }
    }

    override fun readResponse(
        dataOut: ByteArray,
        bytesToRead: Int,
        bytesRead: IntRef,
        callback: CefCallback,
    ): Boolean {
        val input = stream
        if (input == null) {
            bytesRead.set(0)
            return false
        }
        val n = input.read(dataOut, 0, bytesToRead)
        if (n <= 0) {
            bytesRead.set(0)
            closeStream()
            return false
        }
        bytesRead.set(n)
        return true
    }

    override fun cancel() {
        closeStream()
    }

    private fun openResource(url: String) {
        closeStream()
        contentLength = 0
        contentType = null
        val path = resourcePathFromUrl(url) ?: run {
            status = 404
            mimeType = "text/plain"
            return
        }
        mimeType = mimeTypeFor(path)
        contentType = contentTypeFor(path)
        val resource = normalizeClasspathPath("$basePath/$path")
        val bytes = classLoader.getResourceAsStream(resource)?.use { it.readBytes() }
        if (bytes == null) {
            status = 404
            stream = null
            return
        }
        status = 200
        contentLength = bytes.size
        stream = ByteArrayInputStream(bytes)
    }

    private fun closeStream() {
        try {
            stream?.close()
        } catch (_: Exception) {
        }
        stream = null
    }

    companion object {
        fun resourcePathFromUrl(url: String): String? {
            return try {
                val uri = URI(url)
                var path = uri.path.orEmpty()
                if (path.isEmpty() || path == "/") {
                    path = "/index.html"
                }
                path.trimStart('/').takeIf { it.isNotEmpty() && !it.contains("..") }
            } catch (_: Exception) {
                null
            }
        }

        /** Bare type for [CefResponse.setMimeType] — no parameters. */
        fun mimeTypeFor(path: String): String {
            val ext = path.substringAfterLast('.', "").lowercase()
            return when (ext) {
                "html", "htm" -> "text/html"
                "js", "mjs", "cjs" -> "text/javascript"
                "css" -> "text/css"
                "json", "map" -> "application/json"
                "svg" -> "image/svg+xml"
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                "gif" -> "image/gif"
                "webp" -> "image/webp"
                "ico" -> "image/x-icon"
                "woff" -> "font/woff"
                "woff2" -> "font/woff2"
                "ttf" -> "font/ttf"
                "wasm" -> "application/wasm"
                "txt" -> "text/plain"
                else -> "application/octet-stream"
            }
        }

        fun contentTypeFor(path: String): String? {
            val mime = mimeTypeFor(path)
            return when {
                mime.startsWith("text/") ||
                    mime == "application/json" ||
                    mime == "application/javascript" ||
                    mime == "image/svg+xml" -> "$mime; charset=utf-8"
                else -> null
            }
        }

        private fun normalizeClasspathPath(path: String): String =
            path.trimStart('/').replace('\\', '/')
    }
}
