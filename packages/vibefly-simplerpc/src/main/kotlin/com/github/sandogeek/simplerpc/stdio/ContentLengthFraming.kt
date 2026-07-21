package com.github.sandogeek.simplerpc.stdio

import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.charset.StandardCharsets

/**
 * LSP-style Content-Length framing for SimpleRpc over byte streams (stdio).
 *
 * Wire shape:
 * ```
 * Content-Length: <utf8-byte-count>\r\n
 * \r\n
 * <utf-8 json body>
 * ```
 *
 * Framing only — payload is an opaque UTF-8 JSON string produced by SimpleRpc.
 */
object ContentLengthFraming {
    private const val HEADER_CONTENT_LENGTH = "Content-Length"
    private val HEADER_SEPARATOR = "\r\n\r\n".toByteArray(StandardCharsets.US_ASCII)

    /**
     * Encodes [message] as a single framed frame into [output].
     * Not thread-safe; callers must serialize concurrent writes.
     */
    fun writeFrame(output: OutputStream, message: String) {
        val body = message.toByteArray(StandardCharsets.UTF_8)
        val header = "$HEADER_CONTENT_LENGTH: ${body.size}\r\n\r\n"
            .toByteArray(StandardCharsets.US_ASCII)
        output.write(header)
        output.write(body)
        output.flush()
    }

    /**
     * Reads one framed message from [input].
     *
     * @return UTF-8 body string, or null if the stream is cleanly at EOF before any header bytes.
     * @throws EOFException if the stream ends mid-frame.
     * @throws IOException on malformed headers or I/O errors.
     */
    fun readFrame(input: InputStream): String? {
        val headerBytes = readUntilHeaderEnd(input) ?: return null
        val contentLength = parseContentLength(headerBytes)
        val body = readExact(input, contentLength)
        return String(body, StandardCharsets.UTF_8)
    }

    private fun readUntilHeaderEnd(input: InputStream): ByteArray? {
        val buffer = ByteArrayOutputStream(128)
        var match = 0
        while (true) {
            val b = input.read()
            if (b < 0) {
                if (buffer.size() == 0 && match == 0) {
                    return null
                }
                throw EOFException("Unexpected EOF while reading Content-Length headers")
            }
            buffer.write(b)
            if (b.toByte() == HEADER_SEPARATOR[match]) {
                match++
                if (match == HEADER_SEPARATOR.size) {
                    return buffer.toByteArray()
                }
            } else {
                // Partial match restart (e.g. \r\n\rX)
                match = if (b.toByte() == HEADER_SEPARATOR[0]) 1 else 0
            }
            if (buffer.size() > 64 * 1024) {
                throw IOException("RPC frame headers exceed 64 KiB")
            }
        }
    }

    private fun parseContentLength(headerBlock: ByteArray): Int {
        // Strip trailing \r\n\r\n
        val text = String(
            headerBlock,
            0,
            headerBlock.size - HEADER_SEPARATOR.size,
            StandardCharsets.US_ASCII,
        )
        var contentLength: Int? = null
        for (line in text.split("\r\n")) {
            if (line.isEmpty()) continue
            val colon = line.indexOf(':')
            if (colon <= 0) continue
            val name = line.substring(0, colon).trim()
            val value = line.substring(colon + 1).trim()
            if (name.equals(HEADER_CONTENT_LENGTH, ignoreCase = true)) {
                contentLength = value.toIntOrNull()
                    ?: throw IOException("Invalid Content-Length: $value")
            }
        }
        val length = contentLength
            ?: throw IOException("Missing Content-Length header")
        if (length < 0) {
            throw IOException("Negative Content-Length: $length")
        }
        if (length > 64 * 1024 * 1024) {
            throw IOException("Content-Length too large: $length")
        }
        return length
    }

    private fun readExact(input: InputStream, length: Int): ByteArray {
        val body = ByteArray(length)
        var offset = 0
        while (offset < length) {
            val n = input.read(body, offset, length - offset)
            if (n < 0) {
                throw EOFException(
                    "Unexpected EOF reading frame body ($offset/$length bytes)",
                )
            }
            offset += n
        }
        return body
    }

    /** Test helper: encode a message to bytes without a stream. */
    fun encode(message: String): ByteArray {
        val body = message.toByteArray(StandardCharsets.UTF_8)
        val header = "$HEADER_CONTENT_LENGTH: ${body.size}\r\n\r\n"
            .toByteArray(StandardCharsets.US_ASCII)
        return header + body
    }
}
