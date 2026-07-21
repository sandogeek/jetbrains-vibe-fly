package com.github.sandogeek.simplerpc.protocol

import java.lang.reflect.Type
import java.lang.reflect.WildcardType
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.InternalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.serializer

@OptIn(ExperimentalSerializationApi::class, InternalSerializationApi::class)
internal object JsonCodec {
    val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        isLenient = true
        coerceInputValues = true
        explicitNulls = false
    }

    fun toJsonElement(value: Any?, type: Type): JsonElement {
        if (value == null || isUnitType(type)) return JsonNull
        if (value is JsonElement) return value
        @Suppress("UNCHECKED_CAST")
        val serializer = serializer(unwrapType(type)) as KSerializer<Any>
        return json.encodeToJsonElement(serializer, value)
    }

    fun fromJsonElement(element: JsonElement?, type: Type): Any? {
        if (isUnitType(type)) return Unit
        if (element == null || element is JsonNull) return null
        @Suppress("UNCHECKED_CAST")
        val serializer = serializer(unwrapType(type)) as KSerializer<Any>
        return json.decodeFromJsonElement(serializer, element)
    }

    fun isUnitType(type: Type): Boolean {
        val resolved = unwrapType(type)
        return resolved == Void.TYPE ||
            resolved == Void::class.java ||
            resolved == Unit::class.java ||
            (resolved is Class<*> && resolved.name == "kotlin.Unit")
    }

    /** Strip wildcard bounds so Continuation<? super List<Foo>> yields List<Foo>. */
    private fun unwrapType(type: Type): Type {
        return when (type) {
            is WildcardType -> {
                type.lowerBounds.firstOrNull()
                    ?: type.upperBounds.firstOrNull { it != Any::class.java }
                    ?: type.upperBounds.firstOrNull()
                    ?: type
            }
            else -> type
        }
    }
}
