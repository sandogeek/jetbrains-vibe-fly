package com.github.sandogeek.simplerpc.stdio

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.nio.charset.StandardCharsets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test

class ContentLengthFramingTest {

    @Test
    fun roundTripSingleMessage() {
        val original = """{"t":"req","id":"k:1","s":"Host","i":1,"a":[]}"""
        val encoded = ContentLengthFraming.encode(original)
        val decoded = ContentLengthFraming.readFrame(ByteArrayInputStream(encoded))
        assertEquals(original, decoded)
    }

    @Test
    fun sequentialMessagesPreserveOrder() {
        val out = ByteArrayOutputStream()
        ContentLengthFraming.writeFrame(out, """{"t":"ok","id":"1","r":1}""")
        ContentLengthFraming.writeFrame(out, """{"t":"ok","id":"2","r":2}""")
        val input = ByteArrayInputStream(out.toByteArray())
        assertEquals("""{"t":"ok","id":"1","r":1}""", ContentLengthFraming.readFrame(input))
        assertEquals("""{"t":"ok","id":"2","r":2}""", ContentLengthFraming.readFrame(input))
        assertNull(ContentLengthFraming.readFrame(input))
    }

    @Test
    fun utf8BodyByteLengthNotCharLength() {
        val message = """{"t":"ok","id":"1","r":"你好"}"""
        val bodyBytes = message.toByteArray(StandardCharsets.UTF_8)
        val frame = ContentLengthFraming.encode(message)
        val header = "Content-Length: ${bodyBytes.size}\r\n\r\n"
        assertEquals(
            header,
            String(frame, 0, header.toByteArray(StandardCharsets.US_ASCII).size, StandardCharsets.US_ASCII),
        )
        assertEquals(message, ContentLengthFraming.readFrame(ByteArrayInputStream(frame)))
    }

    @Test
    fun emptyBodyAllowed() {
        val frame = "Content-Length: 0\r\n\r\n".toByteArray(StandardCharsets.US_ASCII)
        assertEquals("", ContentLengthFraming.readFrame(ByteArrayInputStream(frame)))
    }

    @Test
    fun missingContentLengthThrows() {
        val frame = "Content-Type: application/json\r\n\r\n{}".toByteArray(StandardCharsets.US_ASCII)
        try {
            ContentLengthFraming.readFrame(ByteArrayInputStream(frame))
            fail("expected IOException")
        } catch (_: IOException) {
            // expected
        }
    }

    @Test
    fun truncatedBodyThrowsEof() {
        val frame = "Content-Length: 10\r\n\r\nabc".toByteArray(StandardCharsets.US_ASCII)
        try {
            ContentLengthFraming.readFrame(ByteArrayInputStream(frame))
            fail("expected EOFException")
        } catch (_: EOFException) {
            // expected
        }
    }

    @Test
    fun invalidContentLengthThrows() {
        for (value in listOf("1junk", "1.5", "1e2", "")) {
            val frame = "Content-Length: $value\r\n\r\nX".toByteArray(StandardCharsets.US_ASCII)
            try {
                ContentLengthFraming.readFrame(ByteArrayInputStream(frame))
                fail("expected IOException for Content-Length: $value")
            } catch (_: IOException) {
                // expected
            }
        }
    }

    @Test
    fun cleanEmptyStreamReturnsNull() {
        assertNull(ContentLengthFraming.readFrame(ByteArrayInputStream(ByteArray(0))))
    }
}
