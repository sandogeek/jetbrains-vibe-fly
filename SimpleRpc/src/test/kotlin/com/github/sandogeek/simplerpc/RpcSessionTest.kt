package com.github.sandogeek.simplerpc

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin
import com.github.sandogeek.simplerpc.jcef.CefMessageRouterTransport
import com.github.sandogeek.simplerpc.protocol.RpcMessage
import com.github.sandogeek.simplerpc.transport.LoopbackTransport
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class RpcSessionTest {

    @TsCallKotlin
    interface HostApi {
        @RpcFun(1)
        suspend fun getVersion(): String

        @RpcFun(2)
        suspend fun add(a: Int, b: Int): Int

        @RpcFun(3)
        suspend fun log(message: String)
    }

    @TsCallKotlin
    interface EchoApi {
        @RpcFun(1)
        suspend fun echo(value: String): String

        @RpcFun(2)
        suspend fun echo(value: Int): Int
    }

    @KotlinCallTs
    interface WebApi {
        @RpcFun(1)
        suspend fun greet(name: String): String

        @RpcFun(2)
        suspend fun notifyReady()
    }

    /** Peer-side registration of WebApi handlers (service name WebApi). */
    @TsCallKotlin("WebApi")
    interface WebApiPeer {
        @RpcFun(1)
        suspend fun greet(name: String): String

        @RpcFun(2)
        suspend fun notifyReady()
    }

    @KotlinCallTs
    interface EchoTsApi {
        @RpcFun(10)
        suspend fun echo(value: String): String

        @RpcFun(11)
        suspend fun echo(value: Int): Int
    }

    @TsCallKotlin("EchoTsApi")
    interface EchoTsPeer {
        @RpcFun(10)
        suspend fun echo(value: String): String

        @RpcFun(11)
        suspend fun echo(value: Int): Int
    }

    @Test
    fun tsCallKotlin_roundTrip() {
        val loop = LoopbackTransport()
        val kotlinSession = SimpleRpc.open(loop.endpointA())
        kotlinSession.registerImplementation(object : HostApi {
            override suspend fun getVersion() = "1.0.0"
            override suspend fun add(a: Int, b: Int) = a + b
            override suspend fun log(message: String) {}
        })

        val received = CopyOnWriteArrayList<RpcMessage.Response>()
        loop.endpointB().setIncomingHandler { raw ->
            val msg = RpcMessage.parse(raw)
            if (msg is RpcMessage.Response) {
                received.add(msg)
            }
        }

        loop.endpointB().sendToRemote(
            RpcMessage.Request(
                id = "1",
                service = "HostApi",
                methodId = 1,
                args = emptyList(),
            ).toJson(),
        )
        awaitUntil { received.isNotEmpty() }
        assertEquals(1, received.size)
        val first = received[0] as RpcMessage.Response.Success
        assertEquals("1.0.0", first.result.jsonPrimitive.content)

        loop.endpointB().sendToRemote(
            RpcMessage.Request(
                id = "2",
                service = "HostApi",
                methodId = 2,
                args = listOf(JsonPrimitive(2), JsonPrimitive(3)),
            ).toJson(),
        )
        awaitUntil { received.size >= 2 }
        val second = received[1] as RpcMessage.Response.Success
        assertEquals(5, second.result.jsonPrimitive.int)

        kotlinSession.close()
    }

    @Test
    fun kotlinCallTs_proxyRoundTrip() = runBlocking {
        val loop = LoopbackTransport()
        val kotlinSession = SimpleRpc.open(loop.endpointA())
        val tsSession = SimpleRpc.open(loop.endpointB())

        tsSession.register(WebApiPeer::class.java, object : WebApiPeer {
            override suspend fun greet(name: String) = "hello $name"
            override suspend fun notifyReady() {}
        })

        val web = kotlinSession.proxy(WebApi::class.java)
        assertEquals("hello world", web.greet("world"))
        web.notifyReady()

        kotlinSession.close()
        tsSession.close()
    }

    @Test
    fun outboundRequestIds_areMonotonicPerSessionAndNamespacedAcrossSessions() = runBlocking {
        val firstLoop = LoopbackTransport()
        val firstSession = SimpleRpc.open(firstLoop.endpointA())
        val firstSessionRequests = CopyOnWriteArrayList<RpcMessage.Request>()
        firstLoop.endpointB().setIncomingHandler { raw ->
            val request = RpcMessage.parse(raw) as? RpcMessage.Request ?: return@setIncomingHandler
            firstSessionRequests.add(request)
            firstLoop.endpointB().sendToRemote(
                RpcMessage.Response.Success(
                    request.id,
                    result = JsonPrimitive(
                        when (request.service) {
                            "WebApi" -> "hello"
                            "EchoTsApi" -> "echo"
                            else -> error("Unexpected service ${request.service}")
                        },
                    ),
                ).toJson(),
            )
        }

        assertEquals("hello", firstSession.proxy(WebApi::class.java).greet("world"))
        assertEquals("echo", firstSession.proxy(EchoTsApi::class.java).echo("value"))

        val secondLoop = LoopbackTransport()
        val secondSession = SimpleRpc.open(secondLoop.endpointA())
        val secondSessionRequests = CopyOnWriteArrayList<RpcMessage.Request>()
        secondLoop.endpointB().setIncomingHandler { raw ->
            val request = RpcMessage.parse(raw) as? RpcMessage.Request ?: return@setIncomingHandler
            secondSessionRequests.add(request)
            secondLoop.endpointB().sendToRemote(
                RpcMessage.Response.Success(request.id, JsonPrimitive("hello again")).toJson(),
            )
        }

        assertEquals("hello again", secondSession.proxy(WebApi::class.java).greet("again"))

        val firstId = firstSessionRequests[0].id.split(':')
        val secondId = firstSessionRequests[1].id.split(':')
        val otherSessionId = secondSessionRequests[0].id.split(':')
        assertEquals(listOf("k", firstId[1], "1"), firstId)
        assertEquals(listOf("k", firstId[1], "2"), secondId)
        assertEquals("k", otherSessionId[0])
        assertEquals("1", otherSessionId[2])
        assertTrue(firstId[1] != otherSessionId[1])

        firstSession.close()
        secondSession.close()
    }

    @Test
    fun sameNameMethods_dispatchByMethodId() {
        val loop = LoopbackTransport()
        val kotlinSession = SimpleRpc.open(loop.endpointA())
        kotlinSession.registerImplementation(object : EchoApi {
            override suspend fun echo(value: String) = "s:$value"
            override suspend fun echo(value: Int) = value * 2
        })

        val received = CopyOnWriteArrayList<RpcMessage.Response>()
        loop.endpointB().setIncomingHandler { raw ->
            val msg = RpcMessage.parse(raw)
            if (msg is RpcMessage.Response) {
                received.add(msg)
            }
        }

        loop.endpointB().sendToRemote(
            RpcMessage.Request(
                id = "e1",
                service = "EchoApi",
                methodId = 1,
                args = listOf(JsonPrimitive("hi")),
            ).toJson(),
        )
        awaitUntil { received.isNotEmpty() }
        assertEquals(
            "s:hi",
            (received[0] as RpcMessage.Response.Success).result.jsonPrimitive.content,
        )

        loop.endpointB().sendToRemote(
            RpcMessage.Request(
                id = "e2",
                service = "EchoApi",
                methodId = 2,
                args = listOf(JsonPrimitive(21)),
            ).toJson(),
        )
        awaitUntil { received.size >= 2 }
        assertEquals(
            42,
            (received[1] as RpcMessage.Response.Success).result.jsonPrimitive.int,
        )

        kotlinSession.close()
    }

    @Test
    fun sameNameMethods_proxyUsesMethodId() = runBlocking {
        val loop = LoopbackTransport()
        val kotlinSession = SimpleRpc.open(loop.endpointA())
        val tsSession = SimpleRpc.open(loop.endpointB())

        tsSession.register(EchoTsPeer::class.java, object : EchoTsPeer {
            override suspend fun echo(value: String) = "ts:$value"
            override suspend fun echo(value: Int) = value + 1
        })

        val api = kotlinSession.proxy(EchoTsApi::class.java)
        assertEquals("ts:ok", api.echo("ok"))
        assertEquals(8, api.echo(7))

        kotlinSession.close()
        tsSession.close()
    }

    @Test
    fun remoteError_propagates() = runBlocking {
        val loop = LoopbackTransport()
        val kotlinSession = SimpleRpc.open(loop.endpointA())
        val tsSession = SimpleRpc.open(loop.endpointB())

        tsSession.register(WebApiPeer::class.java, object : WebApiPeer {
            override suspend fun greet(name: String): String {
                throw IllegalStateException("boom")
            }
            override suspend fun notifyReady() {}
        })

        val web = kotlinSession.proxy(WebApi::class.java)
        try {
            web.greet("x")
            fail("expected RpcRemoteException")
        } catch (e: RpcRemoteException) {
            assertTrue(e.message!!.contains("boom"))
        }

        kotlinSession.close()
        tsSession.close()
    }

    @Test
    fun requestTimeout_failsAndSendsCancel() = runBlocking {
        val loop = LoopbackTransport()
        val kotlinSession = SimpleRpc.open(
            loop.endpointA(),
            requestTimeout = 80.milliseconds,
        )
        // No peer handler: request never answered.
        val cancels = CopyOnWriteArrayList<String>()
        loop.endpointB().setIncomingHandler { raw ->
            val msg = RpcMessage.parse(raw)
            if (msg is RpcMessage.Cancel) {
                cancels.add(msg.id)
            }
        }

        val web = kotlinSession.proxy(WebApi::class.java)
        try {
            web.greet("x")
            fail("expected RpcTimeoutException")
        } catch (e: RpcTimeoutException) {
            assertTrue(e.message!!.contains("timed out"))
            assertTrue(e.requestId != null)
        }
        awaitUntil { cancels.isNotEmpty() }
        assertEquals(1, cancels.size)

        kotlinSession.close()
    }

    @Test
    fun jobCancel_sendsCancelAndDoesNotHang() = runBlocking {
        val loop = LoopbackTransport()
        val kotlinSession = SimpleRpc.open(
            loop.endpointA(),
            requestTimeout = 30_000.milliseconds,
        )
        val cancels = CopyOnWriteArrayList<String>()
        loop.endpointB().setIncomingHandler { raw ->
            val msg = RpcMessage.parse(raw)
            if (msg is RpcMessage.Cancel) {
                cancels.add(msg.id)
            }
            // never respond to req
        }

        val web = kotlinSession.proxy(WebApi::class.java)
        val job = async { web.greet("x") }
        awaitUntil {
            // wait until request is in flight (cancel list still empty, job active)
            job.isActive
        }
        delay(30)
        job.cancel()
        try {
            job.await()
            fail("expected CancellationException")
        } catch (_: CancellationException) {
        }
        awaitUntil { cancels.isNotEmpty() }
        assertEquals(1, cancels.size)

        kotlinSession.close()
    }

    @Test
    fun sendFailure_failsPendingAndDoesNotHang() = runBlocking {
        val transport = object : com.github.sandogeek.simplerpc.transport.RpcTransport {
            override fun sendToRemote(message: String) {
                throw IllegalStateException("transport down")
            }

            override fun setIncomingHandler(handler: ((message: String) -> Unit)?) {}
        }
        val session = SimpleRpc.open(
            transport,
            requestTimeout = Duration.INFINITE,
        )
        val web = session.proxy(WebApi::class.java)
        try {
            withTimeout(1_000) {
                web.greet("x")
            }
            fail("expected send failure")
        } catch (e: IllegalStateException) {
            assertTrue(e.message!!.contains("transport down"))
        }
        session.close()
    }

    @Test
    fun timeout_sendCancelFailure_stillFailsCall() = runBlocking {
        val transport = object : com.github.sandogeek.simplerpc.transport.RpcTransport {
            override fun sendToRemote(message: String) {
                val msg = RpcMessage.parse(message)
                if (msg is RpcMessage.Cancel) {
                    throw IllegalStateException("cancel send failed")
                }
                // Drop requests: never respond.
            }

            override fun setIncomingHandler(handler: ((message: String) -> Unit)?) {}
        }
        val session = SimpleRpc.open(
            transport,
            requestTimeout = 50.milliseconds,
        )
        val web = session.proxy(WebApi::class.java)
        try {
            web.greet("x")
            fail("expected RpcTimeoutException")
        } catch (e: RpcTimeoutException) {
            assertTrue(e.message!!.contains("timed out"))
        }
        session.close()
    }

    @Test
    fun peerCancel_abortsInboundDispatch() = runBlocking {
        val loop = LoopbackTransport()
        val kotlinSession = SimpleRpc.open(loop.endpointA())
        val started = CompletableDeferred<Unit>()
        val cancelled = AtomicBoolean(false)
        val completed = AtomicBoolean(false)

        kotlinSession.registerImplementation(object : HostApi {
            override suspend fun getVersion(): String {
                started.complete(Unit)
                try {
                    delay(10_000)
                    completed.set(true)
                    return "late"
                } catch (e: CancellationException) {
                    cancelled.set(true)
                    throw e
                }
            }

            override suspend fun add(a: Int, b: Int) = a + b
            override suspend fun log(message: String) {}
        })

        val responses = AtomicInteger(0)
        loop.endpointB().setIncomingHandler { raw ->
            if (RpcMessage.parse(raw) is RpcMessage.Response) {
                responses.incrementAndGet()
            }
        }

        loop.endpointB().sendToRemote(
            RpcMessage.Request(
                id = "slow-1",
                service = "HostApi",
                methodId = 1,
                args = emptyList(),
            ).toJson(),
        )
        withTimeout(2000) { started.await() }
        loop.endpointB().sendToRemote(RpcMessage.Cancel("slow-1").toJson())
        awaitUntil(timeoutMs = 2000) { cancelled.get() }
        delay(50)
        assertTrue(cancelled.get())
        assertTrue(!completed.get())
        assertEquals(0, responses.get())

        kotlinSession.close()
    }

    @kotlinx.serialization.Serializable
    data class Foo(val name: String, val n: Int)

    @TsCallKotlin
    interface GenericHostApi {
        @RpcFun(1)
        suspend fun listFoos(): List<Foo>

        @RpcFun(2)
        suspend fun mapFoos(input: Map<String, Foo>): Map<String, Foo>

        @RpcFun(3)
        suspend fun pairFoo(input: Pair<String, Foo>): Pair<String, Foo>
    }

    @KotlinCallTs
    interface GenericTsApi {
        @RpcFun(1)
        suspend fun listFoos(): List<Foo>

        @RpcFun(2)
        suspend fun mapFoos(input: Map<String, Foo>): Map<String, Foo>

        @RpcFun(3)
        suspend fun pairFoo(input: Pair<String, Foo>): Pair<String, Foo>
    }

    @TsCallKotlin("GenericTsApi")
    interface GenericTsPeer {
        @RpcFun(1)
        suspend fun listFoos(): List<Foo>

        @RpcFun(2)
        suspend fun mapFoos(input: Map<String, Foo>): Map<String, Foo>

        @RpcFun(3)
        suspend fun pairFoo(input: Pair<String, Foo>): Pair<String, Foo>
    }

    @KotlinCallTs("GenericHostApi")
    interface GenericHostClient {
        @RpcFun(1)
        suspend fun listFoos(): List<Foo>

        @RpcFun(2)
        suspend fun mapFoos(input: Map<String, Foo>): Map<String, Foo>

        @RpcFun(3)
        suspend fun pairFoo(input: Pair<String, Foo>): Pair<String, Foo>
    }

    @Test
    fun genericCollectionTypes_roundTrip() = runBlocking {
        val loop = LoopbackTransport()
        val kotlinSession = SimpleRpc.open(loop.endpointA())
        val tsSession = SimpleRpc.open(loop.endpointB())

        tsSession.register(GenericTsPeer::class.java, object : GenericTsPeer {
            override suspend fun listFoos() = listOf(Foo("a", 1), Foo("b", 2))
            override suspend fun mapFoos(input: Map<String, Foo>) = input
            override suspend fun pairFoo(input: Pair<String, Foo>) = input
        })

        val api = kotlinSession.proxy(GenericTsApi::class.java)
        assertEquals(listOf(Foo("a", 1), Foo("b", 2)), api.listFoos())
        val map = mapOf("x" to Foo("x", 9))
        assertEquals(map, api.mapFoos(map))
        assertEquals("k" to Foo("v", 3), api.pairFoo("k" to Foo("v", 3)))

        kotlinSession.close()
        tsSession.close()
    }

    @Test
    fun genericCollectionTypes_tsCallKotlin() = runBlocking {
        val loop = LoopbackTransport()
        val kotlinSession = SimpleRpc.open(loop.endpointA())
        kotlinSession.registerImplementation(object : GenericHostApi {
            override suspend fun listFoos() = listOf(Foo("h", 7))
            override suspend fun mapFoos(input: Map<String, Foo>) = input
            override suspend fun pairFoo(input: Pair<String, Foo>) = input.first to input.second
        })

        val peer = SimpleRpc.open(loop.endpointB())
        val client = peer.proxy(GenericHostClient::class.java)
        assertEquals(listOf(Foo("h", 7)), client.listFoos())
        val map = mapOf("m" to Foo("m", 1))
        assertEquals(map, client.mapFoos(map))
        assertEquals("p" to Foo("q", 2), client.pairFoo("p" to Foo("q", 2)))

        kotlinSession.close()
        peer.close()
    }

    @Test
    fun malformedResponse_failsPendingCall() = runBlocking {
        val loop = LoopbackTransport()
        val kotlinSession = SimpleRpc.open(
            loop.endpointA(),
            requestTimeout = 2_000.milliseconds,
        )
        loop.endpointB().setIncomingHandler { raw ->
            val msg = RpcMessage.parse(raw)
            if (msg is RpcMessage.Request) {
                // Valid id but invalid envelope shape for full parse on A.
                loop.endpointB().sendToRemote(
                    """{"t":"ok","id":"${msg.id}","r":}""",
                )
            }
        }

        val web = kotlinSession.proxy(WebApi::class.java)
        try {
            web.greet("x")
            fail("expected RpcRemoteException")
        } catch (e: RpcRemoteException) {
            assertTrue(e.message!!.contains("parse") || e.message!!.contains("decode"))
        }

        kotlinSession.close()
    }

    @Test
    fun deliverToJs_dispatchesHostMessageCustomEvent() {
        val payload = """{"t":"req","id":"a'b\"c\n"}"""
        val script = CefMessageRouterTransport.deliverToJs(payload)
        val expectedArg = kotlinx.serialization.json.JsonPrimitive(payload).toString()
            .replace("\u2028", "\\u2028")
            .replace("\u2029", "\\u2029")
        assertEquals(
            "window.dispatchEvent(new CustomEvent(\"${CefMessageRouterTransport.HOST_MESSAGE_EVENT}\"," +
                "{detail:$expectedArg}));",
            script,
        )
        assertFalse(script.contains("'$payload'"))
        assertFalse(script.contains("__simpleRpcOnHostMessage"))
        assertFalse(script.contains("window.SimpleRpc"))
    }

    @Test
    fun registerImplementation_throwsWhenMultipleTsCallKotlinInterfaces() {
        val loop = LoopbackTransport()
        val session = SimpleRpc.open(loop.endpointA())
        val impl = object : HostApi, EchoApi {
            override suspend fun getVersion() = "1"
            override suspend fun add(a: Int, b: Int) = a + b
            override suspend fun log(message: String) {}
            override suspend fun echo(value: String) = value
            override suspend fun echo(value: Int) = value
        }
        try {
            session.registerImplementation(impl)
            fail("expected IllegalArgumentException for multiple @TsCallKotlin interfaces")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("Multiple @TsCallKotlin"))
            assertTrue(e.message!!.contains("HostApi"))
            assertTrue(e.message!!.contains("EchoApi"))
        }
        // Explicit register still works when ambiguous.
        session.register(HostApi::class.java, impl)
        session.close()
    }

    @Test
    fun handleQuery_holdsCallbackUntilResponse() {
        val scripts = CopyOnWriteArrayList<String>()
        val transport = CefMessageRouterTransport { scripts.add(it) }
        val session = SimpleRpc.open(transport)
        session.registerImplementation(object : HostApi {
            override suspend fun getVersion() = "held"
            override suspend fun add(a: Int, b: Int) = a + b
            override suspend fun log(message: String) {}
        })

        val successes = AtomicInteger(0)
        val failures = AtomicInteger(0)
        val req = RpcMessage.Request(
            id = "q1",
            service = "HostApi",
            methodId = 1,
            args = emptyList(),
        ).toJson()

        val accepted = transport.handleQuery(
            queryId = 42L,
            request = req,
            onSuccess = { successes.incrementAndGet() },
            onFailure = { _, _ -> failures.incrementAndGet() },
        )
        assertTrue(accepted)
        // Callback must not complete until RPC response is written.
        assertEquals(0, successes.get())
        awaitUntil { successes.get() > 0 }
        assertEquals(1, successes.get())
        assertEquals(0, failures.get())
        // deliverToJs encodes the wire JSON as a JSON string literal, so quotes are escaped.
        assertTrue(
            scripts.any {
                it.contains("\\\"t\\\":\\\"ok\\\"") ||
                    it.contains("\"t\":\"ok\"")
            },
        )

        session.close()
    }

    @Test
    fun handleQueryCanceled_injectsCancel() {
        val transport = CefMessageRouterTransport { }
        val session = SimpleRpc.open(transport)
        val started = CompletableDeferred<Unit>()
        val cancelled = AtomicBoolean(false)

        session.registerImplementation(object : HostApi {
            override suspend fun getVersion(): String {
                started.complete(Unit)
                try {
                    delay(10_000)
                    return "nope"
                } catch (e: CancellationException) {
                    cancelled.set(true)
                    throw e
                }
            }

            override suspend fun add(a: Int, b: Int) = a + b
            override suspend fun log(message: String) {}
        })

        val req = RpcMessage.Request(
            id = "cancel-me",
            service = "HostApi",
            methodId = 1,
            args = emptyList(),
        ).toJson()

        transport.handleQuery(
            queryId = 7L,
            request = req,
            onSuccess = { },
            onFailure = { _, _ -> },
        )
        runBlocking { withTimeout(2000) { started.await() } }
        transport.handleQueryCanceled(7L)
        awaitUntil(timeoutMs = 2000) { cancelled.get() }
        assertTrue(cancelled.get())

        session.close()
    }

    @Test
    fun handleQuery_wireCancel_closesHeldCallback() {
        val transport = CefMessageRouterTransport { }
        val session = SimpleRpc.open(transport)
        val started = CompletableDeferred<Unit>()
        val cancelled = AtomicBoolean(false)
        val failures = AtomicInteger(0)

        session.registerImplementation(object : HostApi {
            override suspend fun getVersion(): String {
                started.complete(Unit)
                try {
                    delay(10_000)
                    return "nope"
                } catch (e: CancellationException) {
                    cancelled.set(true)
                    throw e
                }
            }

            override suspend fun add(a: Int, b: Int) = a + b
            override suspend fun log(message: String) {}
        })

        val req = RpcMessage.Request(
            id = "wire-cancel",
            service = "HostApi",
            methodId = 1,
            args = emptyList(),
        ).toJson()

        transport.handleQuery(
            queryId = 99L,
            request = req,
            onSuccess = { },
            onFailure = { code, msg ->
                if (code == 1 && msg == "cancelled") {
                    failures.incrementAndGet()
                }
            },
        )
        runBlocking { withTimeout(2000) { started.await() } }

        // Wire-only cancel (no cefQueryCancel / onQueryCanceled): must still close callback.
        val cancelAccepted = transport.handleQuery(
            queryId = 100L,
            request = """{"t":"cancel","id":"wire-cancel"}""",
            onSuccess = { },
            onFailure = { _, _ -> },
        )
        assertTrue(cancelAccepted)
        awaitUntil(timeoutMs = 2000) { cancelled.get() && failures.get() > 0 }
        assertTrue(cancelled.get())
        assertEquals(1, failures.get())

        session.close()
    }

    private fun awaitUntil(timeoutMs: Long = 2000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (!condition()) {
            if (System.currentTimeMillis() > deadline) {
                fail("condition not met within ${timeoutMs}ms")
            }
            Thread.sleep(10)
        }
    }
}
