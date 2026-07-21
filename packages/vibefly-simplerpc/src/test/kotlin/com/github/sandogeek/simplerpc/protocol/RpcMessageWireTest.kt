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
        val raw = RpcMessage.Response.Success("1", result = JsonPrimitive("v")).toJson()
        assertTrue(raw.contains("\"t\":\"ok\""))
        assertTrue(raw.contains("\"r\":\"v\""))
        assertTrue(!raw.contains("\"e\""))
        val parsed = RpcMessage.parse(raw) as RpcMessage.Response.Success
        assertEquals("v", (parsed.result as JsonPrimitive).content)
    }

    @Test
    fun responseUnitResultEmitsNullR() {
        val raw = RpcMessage.Response.Success("1", result = JsonNull).toJson()
        assertTrue(raw.contains("\"t\":\"ok\""))
        assertTrue(raw.contains("\"r\":null"))
        assertTrue(!raw.contains("\"e\""))
        val parsed = RpcMessage.parse(raw) as RpcMessage.Response.Success
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
        val raw = RpcMessage.Response.Failure("1", error = "boom").toJson()
        assertTrue(raw.contains("\"t\":\"err\""))
        assertTrue(raw.contains("\"e\":\"boom\""))
        assertTrue(!raw.contains("\"r\""))
        val parsed = RpcMessage.parse(raw) as RpcMessage.Response.Failure
        assertEquals("boom", parsed.error)
    }

    @Test
    fun cancelRoundTrip() {
        val raw = RpcMessage.Cancel("c1").toJson()
        assertEquals("""{"t":"cancel","id":"c1"}""", raw)
        assertEquals("c1", (RpcMessage.parse(raw) as RpcMessage.Cancel).id)
    }

    @Test
    fun parseWireShapes() {
        val req = RpcMessage.parse("""{"t":"req","id":"i","s":"S","i":1,"a":[]}""") as RpcMessage.Request
        assertEquals("S", req.service)
        val res = RpcMessage.parse("""{"t":"ok","id":"i","r":null}""") as RpcMessage.Response.Success
        assertEquals(JsonNull, res.result)
        val err = RpcMessage.parse("""{"t":"err","id":"i","e":"x"}""") as RpcMessage.Response.Failure
        assertEquals("x", err.error)
    }
}
