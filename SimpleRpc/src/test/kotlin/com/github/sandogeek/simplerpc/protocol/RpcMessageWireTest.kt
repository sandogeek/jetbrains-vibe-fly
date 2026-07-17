package com.github.sandogeek.simplerpc.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

class RpcMessageWireTest {
    @Test
    fun requestRoundTrip() {
        val msg = RpcMessage.Request("1", "HostApi", 2, listOf(JsonPrimitive("x")))
        val raw = msg.toJson()
        assertTrue(raw.contains("\"t\":\"req\""))
        assertTrue(raw.contains("\"s\":\"HostApi\""))
        assertTrue(raw.contains("\"i\":2"))
        assertTrue(raw.contains("\"a\":"))
        val parsed = RpcMessage.parse(raw) as RpcMessage.Request
        assertEquals("1", parsed.id)
        assertEquals("HostApi", parsed.service)
        assertEquals(2, parsed.methodId)
        assertEquals(1, parsed.args.size)
    }

    @Test
    fun responseSuccessOmitsError() {
        val raw = RpcMessage.Response("1", ok = true, result = JsonPrimitive("v")).toJson()
        assertTrue(raw.contains("\"ok\":true"))
        assertTrue(raw.contains("\"r\":\"v\""))
        assertTrue(!raw.contains("\"e\""))
        val parsed = RpcMessage.parse(raw) as RpcMessage.Response
        assertEquals(true, parsed.ok)
        assertEquals("v", (parsed.result as JsonPrimitive).content)
    }

    @Test
    fun responseUnitResultEmitsNullR() {
        val raw = RpcMessage.Response("1", ok = true, result = JsonNull).toJson()
        assertTrue(raw.contains("\"r\":null"))
        assertTrue(!raw.contains("\"e\""))
        val parsed = RpcMessage.parse(raw) as RpcMessage.Response
        assertEquals(JsonNull, parsed.result)
    }

    @Test
    fun requestEmptyArgsEmitsA() {
        val raw = RpcMessage.Request("1", "HostApi", 1).toJson()
        assertTrue(raw.contains("\"a\":[]"))
        val parsed = RpcMessage.parse(raw) as RpcMessage.Request
        assertEquals(emptyList(), parsed.args)
    }

    @Test
    fun responseFailureKeepsError() {
        val raw = RpcMessage.Response("1", ok = false, error = "boom").toJson()
        assertTrue(raw.contains("\"ok\":false"))
        assertTrue(raw.contains("\"e\":\"boom\""))
        val parsed = RpcMessage.parse(raw) as RpcMessage.Response
        assertEquals(false, parsed.ok)
        assertEquals("boom", parsed.error)
    }

    @Test
    fun cancelRoundTrip() {
        val raw = RpcMessage.Cancel("c1").toJson()
        assertEquals("""{"t":"cancel","id":"c1"}""", raw)
        assertEquals("c1", (RpcMessage.parse(raw) as RpcMessage.Cancel).id)
    }

    @Test
    fun parseLegacyWire() {
        val req = RpcMessage.parse("""{"t":"req","id":"i","s":"S","i":1,"a":[]}""") as RpcMessage.Request
        assertEquals("S", req.service)
        val res = RpcMessage.parse("""{"t":"res","id":"i","ok":true,"r":null}""") as RpcMessage.Response
        assertEquals(JsonNull, res.result)
        val err = RpcMessage.parse("""{"t":"res","id":"i","ok":false,"e":"x"}""") as RpcMessage.Response
        assertEquals("x", err.error)
    }
}
