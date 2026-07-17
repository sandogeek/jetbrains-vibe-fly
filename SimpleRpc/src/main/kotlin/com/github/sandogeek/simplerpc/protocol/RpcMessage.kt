package com.github.sandogeek.simplerpc.protocol

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * Wire envelope for SimpleRpc over CefMessageRouter / executeJavaScript.
 *
 * Request:  {"t":"req","id":"...","s":"Service","i":1,"a":[...]}
 * Success:  {"t":"ok","id":"...","r":...}
 * Failure:  {"t":"err","id":"...","e":"..."}
 * Cancel:   {"t":"cancel","id":"..."}
 *
 * Method identity is the numeric [Request.methodId] (`i` from [@RpcFun]).
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("t")
internal sealed class RpcMessage {
    abstract val id: String

    @Serializable
    @SerialName("req")
    data class Request(
        override val id: String,
        @SerialName("s") val service: String,
        @SerialName("i") val methodId: Int,
        @SerialName("a") val args: List<JsonElement> = emptyList(),
    ) : RpcMessage()

    /** Outbound/inbound RPC outcome; Success and Failure are mutually exclusive. */
    @Serializable
    sealed class Response : RpcMessage() {
        @Serializable
        @SerialName("ok")
        data class Success(
            override val id: String,
            @SerialName("r") val result: JsonElement = JsonNull,
        ) : Response()

        @Serializable
        @SerialName("err")
        data class Failure(
            override val id: String,
            @SerialName("e") val error: String,
        ) : Response()
    }

    /** Peer cancelled an in-flight request identified by [id]. */
    @Serializable
    @SerialName("cancel")
    data class Cancel(
        override val id: String,
    ) : RpcMessage()

    fun toJson(): String = json.encodeToString(serializer(), this)

    companion object {
        private val json = Json {
            ignoreUnknownKeys = true
            isLenient = true
            encodeDefaults = true
            explicitNulls = false
        }

        fun parse(raw: String): RpcMessage = json.decodeFromString(serializer(), raw)
    }
}
