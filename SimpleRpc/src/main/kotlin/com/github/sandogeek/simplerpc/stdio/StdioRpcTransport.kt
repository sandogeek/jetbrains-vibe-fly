package com.github.sandogeek.simplerpc.stdio

import com.github.sandogeek.simplerpc.transport.RpcTransport
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * [RpcTransport] over a bidirectional byte stream with Content-Length framing.
 *
 * Intended for JVM ↔ Node.js SimpleRpc: plugin writes to the child process
 * `stdin` and reads from its `stdout`. Node must keep protocol data on stdout
 * only; logs go to stderr so they never pollute the frame stream.
 *
 * Wire-up:
 * ```kotlin
 * val process = ProcessBuilder("node", "agent.js")
 *     .redirectError(ProcessBuilder.Redirect.INHERIT)
 *     .start()
 * val transport = StdioRpcTransport(
 *     input = process.inputStream,   // Node stdout
 *     output = process.outputStream, // Node stdin
 *     onClosed = { process.destroy() },
 * )
 * val session = SimpleRpc.open(transport) // auto-closes when stdin/stdout ends
 * // ... register / proxy ...
 * // On process exit or session teardown:
 * transport.close()
 * process.destroy()
 * ```
 *
 * TypeScript side: `createStdioSimpleRpc({ input: process.stdin, output: process.stdout })`
 * (or PassThrough streams in tests). Peer closes automatically on input EOF.
 *
 * Messages are delivered to the incoming handler serially and in arrival order
 * on a dedicated reader thread, so cancel cannot overtake its request.
 *
 * The reader starts only when a non-null [setIncomingHandler] is installed
 * (typically from [com.github.sandogeek.simplerpc.RpcSession] construction), so
 * early peer frames are not drained and dropped before the session is ready.
 *
 * On clean EOF, mid-frame EOF, or I/O error, the transport marks itself closed and
 * notifies both [onClosed] and [setCloseHandler] once so [RpcSession] fails pending
 * requests immediately (not only after [requestTimeout]).
 */
class StdioRpcTransport(
    private val input: InputStream,
    private val output: OutputStream,
    private val onClosed: (() -> Unit)? = null,
    private val closeStreams: Boolean = false,
) : RpcTransport {

    private val incoming = AtomicReference<((String) -> Unit)?>(null)
    private val closeHandler = AtomicReference<(() -> Unit)?>(null)
    private val closed = AtomicBoolean(false)
    private val writeLock = Any()
    private val readerStarted = AtomicBoolean(false)
    @Volatile
    private var readerThread: Thread? = null

    val isClosed: Boolean
        get() = closed.get()

    override fun sendToRemote(message: String) {
        if (closed.get()) {
            throw IOException("StdioRpcTransport is closed")
        }
        try {
            synchronized(writeLock) {
                if (closed.get()) {
                    throw IOException("StdioRpcTransport is closed")
                }
                ContentLengthFraming.writeFrame(output, message)
            }
        } catch (e: IOException) {
            markClosed()
            throw e
        }
    }

    /**
     * Installs the session handler. The dedicated reader thread starts only once a
     * non-null handler is set, so frames are never drained before [RpcSession] is
     * ready (construction → [SimpleRpc.open] is a race window otherwise).
     */
    override fun setIncomingHandler(handler: ((message: String) -> Unit)?) {
        incoming.set(handler)
        if (handler != null) {
            startReaderIfNeeded()
        }
    }

    override fun setCloseHandler(handler: (() -> Unit)?) {
        closeHandler.set(handler)
    }

    /**
     * Stops the reader (best-effort: interrupt always; close [input]/[output] when
     * [closeStreams] is true so a blocked [InputStream.read] unblocks), notifies close
     * listeners once, and drops any further incoming delivery.
     *
     * Plain [InputStream.read] does not honor thread interrupt. With [closeStreams] false
     * (default), the reader may remain blocked until the peer closes the stream or the
     * process is destroyed via [onClosed]. Set [closeStreams] true when this transport
     * owns the streams and must stop the reader promptly.
     */
    fun close() {
        markClosed()
        if (closeStreams) {
            try {
                input.close()
            } catch (_: Exception) {
            }
            try {
                output.close()
            } catch (_: Exception) {
            }
        }
        // Reader may be blocked in input.read; interrupt to wake when the stream supports it.
        val thread = readerThread
        if (thread != null && thread !== Thread.currentThread()) {
            thread.interrupt()
        }
    }

    private fun startReaderIfNeeded() {
        if (closed.get() || !readerStarted.compareAndSet(false, true)) {
            return
        }
        val thread = Thread(
            {
                try {
                    readLoop()
                } finally {
                    markClosed()
                }
            },
            "SimpleRpc-stdio-reader",
        ).apply {
            isDaemon = true
        }
        readerThread = thread
        // If close() raced with start, do not leave a live reader after closed=true.
        if (closed.get()) {
            readerStarted.set(false)
            readerThread = null
            return
        }
        thread.start()
        if (closed.get()) {
            thread.interrupt()
        }
    }

    private fun readLoop() {
        while (!closed.get()) {
            val message = try {
                ContentLengthFraming.readFrame(input)
            } catch (_: InterruptedException) {
                break
            } catch (_: Exception) {
                // EOF mid-frame, malformed header, or I/O error — end session.
                break
            }
            if (message == null) {
                // Clean EOF
                break
            }
            // close() may have raced while blocked in readFrame; never deliver after close.
            if (closed.get()) {
                break
            }
            val handler = incoming.get()
            if (handler != null) {
                try {
                    handler(message)
                } catch (_: Exception) {
                    // Session handlers should not throw; ignore to keep stream alive.
                }
            }
        }
    }

    private fun markClosed() {
        if (!closed.compareAndSet(false, true)) return
        // Drop handler so a frame completed after close is never delivered.
        incoming.set(null)
        val constructorCallback = onClosed
        if (constructorCallback != null) {
            try {
                constructorCallback()
            } catch (_: Exception) {
            }
        }
        val handler = closeHandler.getAndSet(null)
        if (handler != null) {
            try {
                handler()
            } catch (_: Exception) {
            }
        }
    }
}
