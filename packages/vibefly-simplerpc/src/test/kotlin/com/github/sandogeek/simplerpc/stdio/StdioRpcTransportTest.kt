package com.github.sandogeek.simplerpc.stdio

import com.github.sandogeek.simplerpc.SimpleRpc
import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.time.Duration.Companion.seconds
import com.github.sandogeek.simplerpc.RpcRemoteException
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test


class StdioRpcTransportTest {

    @TsCallKotlin
    interface HostApi {
        @RpcFun(1)
        suspend fun echo(value: String): String

        @RpcFun(2)
        suspend fun add(a: Int, b: Int): Int
    }

    @KotlinCallTs
    interface PeerApi {
        @RpcFun(1)
        suspend fun greet(name: String): String
    }

    @TsCallKotlin("PeerApi")
    interface PeerApiImpl {
        @RpcFun(1)
        suspend fun greet(name: String): String
    }

    @Test
    fun framingRoundTripViaTransport() {
        val aToBOut = PipedOutputStream()
        val aToBIn = PipedInputStream(aToBOut, 64 * 1024)
        val bToAOut = PipedOutputStream()
        val bToAIn = PipedInputStream(bToAOut, 64 * 1024)

        val received = AtomicReference<String?>(null)
        val latch = CountDownLatch(1)

        val sideA = StdioRpcTransport(input = bToAIn, output = aToBOut, closeStreams = true)
        val sideB = StdioRpcTransport(input = aToBIn, output = bToAOut, closeStreams = true)
        sideB.setIncomingHandler { msg ->
            received.set(msg)
            latch.countDown()
        }

        val payload = """{"t":"req","id":"k:1","s":"Host","i":1,"a":["x"]}"""
        sideA.sendToRemote(payload)
        assertTrue(latch.await(2, TimeUnit.SECONDS))
        assertEquals(payload, received.get())

        sideA.close()
        sideB.close()
    }

    /**
     * Frames written before the session installs the handler must still be
     * delivered: reader must not start in the transport constructor.
     */
    @Test
    fun deliversFramesWrittenBeforeHandlerInstalled() {
        val aToBOut = PipedOutputStream()
        val aToBIn = PipedInputStream(aToBOut, 64 * 1024)
        val bToAOut = PipedOutputStream()
        val bToAIn = PipedInputStream(bToAOut, 64 * 1024)

        val sideA = StdioRpcTransport(input = bToAIn, output = aToBOut, closeStreams = true)
        val sideB = StdioRpcTransport(input = aToBIn, output = bToAOut, closeStreams = true)

        val payload = """{"t":"req","id":"k:early","s":"Host","i":1,"a":["early"]}"""
        sideA.sendToRemote(payload)

        val received = AtomicReference<String?>(null)
        val latch = CountDownLatch(1)
        sideB.setIncomingHandler { msg ->
            received.set(msg)
            latch.countDown()
        }

        assertTrue(latch.await(2, TimeUnit.SECONDS))
        assertEquals(payload, received.get())

        sideA.close()
        sideB.close()
    }

    @Test
    fun sessionRoundTripOverStdio() = runBlocking {
        val aToBOut = PipedOutputStream()
        val aToBIn = PipedInputStream(aToBOut, 64 * 1024)
        val bToAOut = PipedOutputStream()
        val bToAIn = PipedInputStream(bToAOut, 64 * 1024)

        val closed = AtomicBoolean(false)
        val transportA = StdioRpcTransport(
            input = bToAIn,
            output = aToBOut,
            onClosed = { closed.set(true) },
            closeStreams = true,
        )
        val transportB = StdioRpcTransport(
            input = aToBIn,
            output = bToAOut,
            closeStreams = true,
        )

        val sessionA = SimpleRpc.open(transportA, requestTimeout = 5.seconds)
        val sessionB = SimpleRpc.open(transportB, requestTimeout = 5.seconds)

        sessionB.registerImplementation(object : HostApi {
            override suspend fun echo(value: String) = "echo:$value"
            override suspend fun add(a: Int, b: Int) = a + b
        })
        sessionA.registerImplementation(object : PeerApiImpl {
            override suspend fun greet(name: String) = "hi $name"
        })

        // A calls HostApi on B (need a proxy that targets HostApi service name).
        // HostApi is @TsCallKotlin on B; from A we need a @KotlinCallTs with same service.
        // Use raw peer registration pattern via PeerApi reverse.
        val peer = sessionB.proxy<PeerApi>()
        val greeting = withTimeout(5.seconds) { peer.greet("stdio") }
        assertEquals("hi stdio", greeting)

        // Reverse: expose HostApi from B and call via a KotlinCallTs twin on A.
        // Register HostApi on B already done. Create twin interface proxy:
        val host = sessionA.proxy(HostApiAsKotlinCallTs::class.java)
        assertEquals("echo:ping", withTimeout(5.seconds) { host.echo("ping") })
        assertEquals(7, withTimeout(5.seconds) { host.add(3, 4) })

        sessionA.close()
        sessionB.close()
        transportA.close()
        transportB.close()
    }

    @KotlinCallTs("HostApi")
    interface HostApiAsKotlinCallTs {
        @RpcFun(1)
        suspend fun echo(value: String): String

        @RpcFun(2)
        suspend fun add(a: Int, b: Int): Int
    }

    @Test
    fun onClosedWhenPeerStreamEnds() {
        val aToBOut = PipedOutputStream()
        val aToBIn = PipedInputStream(aToBOut, 1024)
        val bToAOut = PipedOutputStream()
        val bToAIn = PipedInputStream(bToAOut, 1024)

        val closedLatch = CountDownLatch(1)
        val transport = StdioRpcTransport(
            input = aToBIn,
            output = bToAOut,
            onClosed = { closedLatch.countDown() },
            closeStreams = true,
        )
        // Reader starts only after a handler is installed.
        transport.setIncomingHandler { }
        // Close remote writer's end → EOF on input
        aToBOut.close()
        assertTrue(closedLatch.await(2, TimeUnit.SECONDS))
        assertTrue(transport.isClosed)
        transport.close()
        bToAIn.close()
        bToAOut.close()
    }

    /**
     * close() while the reader is blocked in readFrame must not deliver a frame that
     * becomes available afterward (handler cleared + re-check closed after read returns).
     *
     * The test stream ignores interrupt while blocked so readFrame can complete after
     * close() (mirrors plain InputStream.read, which does not honor interrupt).
     */
    @Test
    fun doesNotDeliverFrameAfterClose() {
        val frame = ContentLengthFraming.encode(
            """{"t":"req","id":"late","s":"Host","i":1,"a":[]}""",
        )
        val firstReadEntered = CountDownLatch(1)
        val releaseRead = AtomicBoolean(false)
        val input = object : java.io.InputStream() {
            private var offset = 0

            private fun waitUntilReleased() {
                firstReadEntered.countDown()
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
                while (!releaseRead.get()) {
                    if (System.nanoTime() > deadline) {
                        throw java.io.IOException("test stream release timed out")
                    }
                    try {
                        Thread.sleep(5)
                    } catch (_: InterruptedException) {
                        // Ignore: simulate non-interruptible blocking read.
                    }
                }
            }

            override fun read(): Int {
                if (offset == 0 && !releaseRead.get()) {
                    waitUntilReleased()
                }
                if (offset >= frame.size) return -1
                return frame[offset++].toInt() and 0xff
            }

            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (offset == 0 && !releaseRead.get()) {
                    waitUntilReleased()
                }
                if (offset >= frame.size) return -1
                val n = minOf(len, frame.size - offset)
                System.arraycopy(frame, offset, b, off, n)
                offset += n
                return n
            }
        }

        val delivered = AtomicBoolean(false)
        val transport = StdioRpcTransport(
            input = input,
            output = java.io.ByteArrayOutputStream(),
            closeStreams = false,
        )
        transport.setIncomingHandler {
            delivered.set(true)
        }

        assertTrue(firstReadEntered.await(2, TimeUnit.SECONDS))
        transport.close()
        assertTrue(transport.isClosed)

        // Unblock readFrame so it returns a complete frame after close.
        releaseRead.set(true)
        Thread.sleep(100)
        assertTrue(!delivered.get())
    }

    /**
     * Transport EOF must close the RpcSession and fail pending calls immediately,
     * including when requestTimeout is infinite (no timer to wake them).
     */
    @Test
    fun sessionClosesAndFailsPendingOnStdioEof() = runBlocking {
        // supervisorScope: pending call failure must not cancel this test scope
        // before we can await/assert it (async is not supervised under plain runBlocking).
        supervisorScope {
            val aToBOut = PipedOutputStream()
            val aToBIn = PipedInputStream(aToBOut, 64 * 1024)
            val bToAOut = PipedOutputStream()
            val bToAIn = PipedInputStream(bToAOut, 64 * 1024)

            val transportA = StdioRpcTransport(
                input = bToAIn,
                output = aToBOut,
                closeStreams = true,
            )
            // No peer session on B: requests hang until transport/session closes.
            val transportB = StdioRpcTransport(
                input = aToBIn,
                output = bToAOut,
                closeStreams = true,
            )
            transportB.setIncomingHandler { /* drop */ }

            val sessionA = SimpleRpc.open(
                transportA,
                requestTimeout = kotlin.time.Duration.INFINITE,
            )
            val host = sessionA.proxy(HostApiAsKotlinCallTs::class.java)

            val pending = async {
                host.echo("never")
            }
            delay(50)

            // Peer dies: EOF on A's input → transport close → session close.
            bToAOut.close()

            try {
                withTimeout(2.seconds) { pending.await() }
                fail("expected RpcSession closed")
            } catch (e: RpcRemoteException) {
                assertEquals("RpcSession closed", e.message)
            }
            assertTrue(sessionA.isClosed)
            assertTrue(transportA.isClosed)

            sessionA.close()
            transportA.close()
            transportB.close()
            aToBOut.close()
            aToBIn.close()
            bToAIn.close()
        }
    }
}
