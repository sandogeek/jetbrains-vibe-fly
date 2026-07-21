package com.github.sandogeek.simplerpc.codegen

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin
import com.github.sandogeek.simplerpc.internal.RpcSuspendRequirement
import com.github.sandogeek.simplerpc.internal.ServiceName
import com.github.sandogeek.simplerpc.internal.SuspendInvoker
import java.lang.reflect.Method
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType
import java.nio.file.Files
import java.nio.file.Path
import kotlin.reflect.KClass
import kotlin.reflect.full.declaredMemberFunctions
import kotlin.reflect.full.valueParameters
import kotlin.reflect.jvm.javaMethod
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.InternalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PolymorphicKind
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.SerialKind
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.serializer

/**
 * Generates TypeScript RPC contract modules from annotated Kotlin interfaces.
 *
 * - [@TsCallKotlin]: `HostApi`, `HostApiDescriptor`, `createHostApiProxy(peer)`
 * - [@KotlinCallTs]: `WebApiService`, `WebApiDescriptor`, `registerWebApiService(peer, impl)`
 */
@OptIn(ExperimentalSerializationApi::class, InternalSerializationApi::class)
object TypeScriptGenerator {

    fun generate(
        interfaces: List<Class<*>>,
        options: TypeScriptGenerationOptions = TypeScriptGenerationOptions(),
    ): String {
        require(interfaces.isNotEmpty()) { "At least one RPC interface is required" }
        val models = interfaces.map { analyze(it) }
        checkUniqueTypeNames(models)
        return emit(models, options)
    }

    fun generate(
        vararg interfaces: Class<*>,
        options: TypeScriptGenerationOptions = TypeScriptGenerationOptions(),
    ): String = generate(interfaces.toList(), options)

    fun generateTo(
        output: Path,
        interfaces: List<Class<*>>,
        options: TypeScriptGenerationOptions = TypeScriptGenerationOptions(),
    ) {
        val source = generate(interfaces, options)
        val parent = output.parent
        if (parent != null) {
            Files.createDirectories(parent)
        }
        Files.writeString(output, source)
    }

    fun generateTo(
        output: Path,
        vararg interfaces: Class<*>,
        options: TypeScriptGenerationOptions = TypeScriptGenerationOptions(),
    ) {
        generateTo(output, interfaces.toList(), options)
    }

    private data class MethodModel(
        val id: Int,
        val kotlinName: String,
        val tsName: String,
        val params: List<ParamModel>,
        val returnTs: String,
        val returnIsUnit: Boolean,
    )

    private data class ParamModel(
        val name: String,
        val tsType: String,
    )

    private data class InterfaceModel(
        val iface: Class<*>,
        val serviceName: String,
        val typeName: String,
        val direction: Direction,
        val methods: List<MethodModel>,
        val dtoTypes: LinkedHashMap<String, String>,
    )

    private enum class Direction { TS_CALL_KOTLIN, KOTLIN_CALL_TS }

    private class TypeContext {
        val dtoTypes = LinkedHashMap<String, String>()
        private val visiting = HashSet<String>()

        fun resolve(type: Type, path: String): String {
            val unwrapped = unwrapType(type)
            return when (unwrapped) {
                is Class<*> -> resolveClass(unwrapped, path)
                is ParameterizedType -> resolveParameterized(unwrapped, path)
                else -> fail(path, "Unsupported type ${unwrapped.typeName}")
            }
        }

        private fun resolveClass(cls: Class<*>, path: String): String {
            when {
                cls == Void.TYPE || cls == Void::class.java || cls == Unit::class.java ||
                    cls.name == "kotlin.Unit" -> return "void"
                cls == String::class.java -> return "string"
                cls == Boolean::class.java || cls == java.lang.Boolean::class.java ||
                    cls == Boolean::class.javaPrimitiveType -> return "boolean"
                cls == Int::class.java || cls == Integer::class.java ||
                    cls == Int::class.javaPrimitiveType ||
                    cls == Long::class.java || cls == java.lang.Long::class.java ||
                    cls == Long::class.javaPrimitiveType ||
                    cls == Short::class.java || cls == java.lang.Short::class.java ||
                    cls == Short::class.javaPrimitiveType ||
                    cls == Byte::class.java || cls == java.lang.Byte::class.java ||
                    cls == Byte::class.javaPrimitiveType ||
                    cls == Double::class.java || cls == java.lang.Double::class.java ||
                    cls == Double::class.javaPrimitiveType ||
                    cls == Float::class.java || cls == java.lang.Float::class.java ||
                    cls == Float::class.javaPrimitiveType -> return "number"
                cls == Char::class.java || cls == Character::class.java ||
                    cls == Char::class.javaPrimitiveType -> return "string"
                cls.isArray -> {
                    val component = cls.componentType
                        ?: fail(path, "Array component type missing")
                    return "Array<${resolveClass(component, "$path[]")}>"
                }
                cls.isEnum -> return emitEnum(cls, path)
                else -> {
                    if (cls.typeParameters.isNotEmpty()) {
                        fail(path, "Unreified generic type ${cls.name}")
                    }
                    return emitSerializableDto(cls, path)
                }
            }
        }

        private fun resolveParameterized(type: ParameterizedType, path: String): String {
            val raw = type.rawType as? Class<*>
                ?: fail(path, "Unsupported parameterized raw type ${type.typeName}")
            val args = type.actualTypeArguments.mapIndexed { index, arg ->
                resolve(unwrapType(arg), "$path<${index}>")
            }
            return when {
                List::class.java.isAssignableFrom(raw) ||
                    Collection::class.java.isAssignableFrom(raw) ||
                    Iterable::class.java.isAssignableFrom(raw) ||
                    Set::class.java.isAssignableFrom(raw) -> {
                    if (args.size != 1) fail(path, "Collection requires one type argument")
                    "Array<${args[0]}>"
                }
                Map::class.java.isAssignableFrom(raw) -> {
                    if (args.size != 2) fail(path, "Map requires two type arguments")
                    val keyType = unwrapType(type.actualTypeArguments[0])
                    if (keyType != String::class.java) {
                        fail(path, "Only Map<String, T> is supported; key is ${keyType.typeName}")
                    }
                    "Record<string, ${args[1]}>"
                }
                raw == Pair::class.java || raw.name == "kotlin.Pair" -> {
                    if (args.size != 2) fail(path, "Pair requires two type arguments")
                    "[${args[0]}, ${args[1]}]"
                }
                else -> {
                    if (raw.typeParameters.isNotEmpty() &&
                        raw.typeParameters.size != args.size
                    ) {
                        fail(path, "Unreified generic type ${raw.name}")
                    }
                    // Generic DTO with concrete args: fall back to SerialDescriptor on erasure
                    // only when no type params remain unresolved.
                    if (raw.typeParameters.isNotEmpty()) {
                        fail(
                            path,
                            "Parameterized DTO ${raw.name} is not supported; " +
                                "use a concrete @Serializable type",
                        )
                    }
                    emitSerializableDto(raw, path)
                }
            }
        }

        private fun emitEnum(cls: Class<*>, path: String): String {
            val name = cls.simpleName.ifEmpty { fail(path, "Anonymous enum") }
            if (dtoTypes.containsKey(name)) return name
            val constants = cls.enumConstants
                ?: fail(path, "Enum constants missing for ${cls.name}")
            val body = constants.joinToString(" | ") { c ->
                val enumConst = c as Enum<*>
                "\"${escapeTsString(enumConst.name)}\""
            }
            dtoTypes[name] = "export type $name = $body;"
            return name
        }

        private fun emitSerializableDto(cls: Class<*>, path: String): String {
            val name = cls.simpleName.ifEmpty { fail(path, "Anonymous type ${cls.name}") }
            if (dtoTypes.containsKey(name)) return name
            if (!visiting.add(cls.name)) {
                // Forward reference for recursive DTOs.
                dtoTypes.putIfAbsent(name, "export interface $name { /* recursive */ }")
                return name
            }
            try {
                val serializer = try {
                    serializer(cls) as KSerializer<*>
                } catch (e: Exception) {
                    fail(
                        path,
                        "Type ${cls.name} is not kotlinx.serialization serializable: ${e.message}",
                    )
                }
                val descriptor = serializer.descriptor
                when (descriptor.kind) {
                    is PolymorphicKind ->
                        fail(path, "Polymorphic type ${cls.name} is not supported")
                    StructureKind.OBJECT -> {
                        dtoTypes[name] = "export interface $name {}"
                    }
                    StructureKind.CLASS -> {
                        val fields = buildString {
                            for (i in 0 until descriptor.elementsCount) {
                                val fieldName = descriptor.getElementName(i)
                                val fieldDesc = descriptor.getElementDescriptor(i)
                                val optional = descriptor.isElementOptional(i)
                                val fieldPath = "$path.$fieldName"
                                val fieldType = withNullability(
                                    serialDescriptorToTs(fieldDesc, fieldPath),
                                    fieldDesc.isNullable,
                                )
                                val optMark = if (optional) "?" else ""
                                append("  ")
                                append(tsPropertyKey(fieldName))
                                append(optMark)
                                append(": ")
                                append(fieldType)
                                append(";\n")
                            }
                        }
                        dtoTypes[name] = "export interface $name {\n$fields}"
                    }
                    StructureKind.LIST, StructureKind.MAP ->
                        fail(path, "Top-level collection DTO ${cls.name} is not supported")
                    is PrimitiveKind, SerialKind.ENUM, SerialKind.CONTEXTUAL ->
                        fail(path, "Unexpected descriptor kind for DTO ${cls.name}: ${descriptor.kind}")
                }
            } finally {
                visiting.remove(cls.name)
            }
            return name
        }

        private fun withNullability(tsType: String, nullable: Boolean): String {
            if (!nullable || tsType == "void" || tsType.endsWith(" | null")) return tsType
            return "$tsType | null"
        }

        private fun serialDescriptorToTs(descriptor: SerialDescriptor, path: String): String {
            if (descriptor.isInline && descriptor.elementsCount == 1) {
                return serialDescriptorToTs(descriptor.getElementDescriptor(0), path)
            }
            return when (val kind = descriptor.kind) {
                is PrimitiveKind.STRING, PrimitiveKind.CHAR -> "string"
                is PrimitiveKind.BOOLEAN -> "boolean"
                is PrimitiveKind.BYTE, PrimitiveKind.SHORT, PrimitiveKind.INT,
                PrimitiveKind.LONG, PrimitiveKind.FLOAT, PrimitiveKind.DOUBLE,
                -> "number"
                SerialKind.ENUM -> {
                    val name = simpleSerialName(descriptor.serialName)
                    if (!dtoTypes.containsKey(name)) {
                        val values = (0 until descriptor.elementsCount).joinToString(" | ") { i ->
                            "\"${escapeTsString(descriptor.getElementName(i))}\""
                        }
                        dtoTypes[name] = "export type $name = $values;"
                    }
                    name
                }
                StructureKind.LIST -> {
                    if (descriptor.elementsCount < 1) {
                        fail(path, "List descriptor has no element type")
                    }
                    val elemDesc = descriptor.getElementDescriptor(0)
                    val elem = withNullability(
                        serialDescriptorToTs(elemDesc, "$path[]"),
                        elemDesc.isNullable,
                    )
                    "Array<$elem>"
                }
                StructureKind.MAP -> {
                    if (descriptor.elementsCount < 2) {
                        fail(path, "Map descriptor incomplete")
                    }
                    val key = descriptor.getElementDescriptor(0)
                    if (key.kind !is PrimitiveKind.STRING) {
                        fail(path, "Only Map with string keys is supported")
                    }
                    val valueDesc = descriptor.getElementDescriptor(1)
                    val value = withNullability(
                        serialDescriptorToTs(valueDesc, "$path.value"),
                        valueDesc.isNullable,
                    )
                    "Record<string, $value>"
                }
                StructureKind.CLASS, StructureKind.OBJECT -> {
                    // Nested anonymous structures use serial name.
                    // Nullable wrappers share the non-null serial name (e.g. Foo? -> Foo).
                    val visitKey = nonNullSerialName(descriptor.serialName)
                    val name = simpleSerialName(descriptor.serialName)
                    if (dtoTypes.containsKey(name)) return name
                    if (!visiting.add(visitKey)) return name
                    try {
                        if (kind == StructureKind.OBJECT) {
                            dtoTypes[name] = "export interface $name {}"
                        } else {
                            val fields = buildString {
                                for (i in 0 until descriptor.elementsCount) {
                                    val fieldName = descriptor.getElementName(i)
                                    val fieldDesc = descriptor.getElementDescriptor(i)
                                    val optional = descriptor.isElementOptional(i)
                                    val fieldType = withNullability(
                                        serialDescriptorToTs(
                                            fieldDesc,
                                            "$path.$fieldName",
                                        ),
                                        fieldDesc.isNullable,
                                    )
                                    val optMark = if (optional) "?" else ""
                                    append("  ")
                                    append(tsPropertyKey(fieldName))
                                    append(optMark)
                                    append(": ")
                                    append(fieldType)
                                    append(";\n")
                                }
                            }
                            dtoTypes[name] = "export interface $name {\n$fields}"
                        }
                    } finally {
                        visiting.remove(visitKey)
                    }
                    name
                }
                is PolymorphicKind -> fail(path, "Polymorphic type at $path is not supported")
                SerialKind.CONTEXTUAL ->
                    fail(path, "Contextual serializer at $path is not supported")
            }
        }
    }

    private fun analyze(iface: Class<*>): InterfaceModel {
        RpcSuspendRequirement.check(iface)
        val direction = when {
            iface.isAnnotationPresent(TsCallKotlin::class.java) -> Direction.TS_CALL_KOTLIN
            iface.isAnnotationPresent(KotlinCallTs::class.java) -> Direction.KOTLIN_CALL_TS
            else -> error("Interface ${iface.name} missing direction annotation")
        }
        val kClass = iface.kotlin
        val typeCtx = TypeContext()
        val rpcMethods = iface.declaredMethods
            .asSequence()
            .filter { RpcSuspendRequirement.isRpcCandidate(it) }
            .sortedWith(compareBy({ it.getAnnotation(RpcFun::class.java)!!.id }, { it.name }))
            .toList()

        val usedTsNames = LinkedHashMap<String, Method>()
        val methods = rpcMethods.map { method ->
            val rpcFun = method.getAnnotation(RpcFun::class.java)!!
            val javaParamTypes = SuspendInvoker.rpcParameterTypes(method)
            val kFunction = kClass.declaredMemberFunctions.firstOrNull { kf ->
                if (kf.javaMethod == method) return@firstOrNull true
                if (kf.name != method.name) return@firstOrNull false
                if (kf.valueParameters.size != javaParamTypes.size) return@firstOrNull false
                // Disambiguate overloads by erased JVM parameter types.
                kf.valueParameters.indices.all { index ->
                    val kErasure = kf.valueParameters[index].type.classifier as? KClass<*>
                    val javaCls = when (val t = unwrapType(javaParamTypes[index])) {
                        is Class<*> -> t
                        is ParameterizedType -> t.rawType as? Class<*>
                        else -> null
                    }
                    kErasure != null && javaCls != null &&
                        (kErasure.java == javaCls ||
                            boxedEquals(kErasure.java, javaCls))
                }
            } ?: fail(
                iface.simpleName + "." + method.name,
                "Unable to resolve Kotlin function metadata",
            )

            val tsName = resolveTsName(method, rpcFun, rpcMethods)
            val prev = usedTsNames.put(tsName, method)
            if (prev != null) {
                fail(
                    iface.simpleName,
                    "Duplicate TypeScript method name '$tsName' for ${prev.name} and ${method.name}; " +
                        "set unique @RpcFun(tsName=...) on overloads",
                )
            }

            val kParams = kFunction.valueParameters
            if (kParams.size != javaParamTypes.size) {
                fail(
                    "${iface.simpleName}.${method.name}",
                    "Parameter count mismatch (kotlin=${kParams.size}, java=${javaParamTypes.size})",
                )
            }
            val usedParamNames = LinkedHashSet<String>()
            val params = kParams.mapIndexed { index, kp ->
                val rawName = kp.name ?: "arg$index"
                val name = uniqueSafeTsIdentifier(rawName, usedParamNames, "arg$index")
                usedParamNames.add(name)
                val path = "${iface.simpleName}.${method.name}.$rawName"
                // Prefer Java generic Type for collections; KType for nullability.
                val fromJava = typeCtx.resolve(javaParamTypes[index], path)
                val nullable = kp.type.isMarkedNullable
                val tsType = if (nullable && !fromJava.endsWith(" | null") && fromJava != "void") {
                    "$fromJava | null"
                } else {
                    fromJava
                }
                ParamModel(name, tsType)
            }

            val returnPath = "${iface.simpleName}.${method.name}.return"
            val returnJava = SuspendInvoker.rpcReturnType(method)
            val returnBase = typeCtx.resolve(returnJava, returnPath)
            val returnNullable = kFunction.returnType.isMarkedNullable
            val returnTs = if (returnNullable && returnBase != "void" && !returnBase.endsWith(" | null")) {
                "$returnBase | null"
            } else {
                returnBase
            }
            val returnIsUnit = returnTs == "void" || returnTs == "void | null"
            MethodModel(
                id = rpcFun.id,
                kotlinName = method.name,
                tsName = tsName,
                params = params,
                returnTs = if (returnIsUnit) "void" else returnTs,
                returnIsUnit = returnIsUnit,
            )
        }

        return InterfaceModel(
            iface = iface,
            serviceName = ServiceName.of(iface),
            typeName = iface.simpleName,
            direction = direction,
            methods = methods,
            dtoTypes = typeCtx.dtoTypes,
        )
    }

    private fun resolveTsName(method: Method, rpcFun: RpcFun, all: List<Method>): String {
        val sameNameCount = all.count { it.name == method.name }
        val tsName = rpcFun.tsName
        if (sameNameCount > 1) {
            require(tsName.isNotEmpty()) {
                "Overloaded method ${method.declaringClass.simpleName}.${method.name} " +
                    "requires unique @RpcFun(tsName=...)"
            }
            return tsName
        }
        return tsName.ifEmpty { method.name }
    }

    private fun checkUniqueTypeNames(models: List<InterfaceModel>) {
        val seen = LinkedHashMap<String, String>()
        for (model in models) {
            val key = model.typeName
            val prev = seen.put(key, model.iface.name)
            require(prev == null) {
                "Duplicate interface simple name '$key' for $prev and ${model.iface.name}"
            }
        }
        val dtoSeen = LinkedHashMap<String, String>()
        for (model in models) {
            for ((name, body) in model.dtoTypes) {
                val prev = dtoSeen.put(name, body)
                if (prev != null && prev != body) {
                    fail(name, "Conflicting DTO definitions for type name '$name'")
                }
            }
        }
    }

    private fun emit(models: List<InterfaceModel>, options: TypeScriptGenerationOptions): String {
        val sb = StringBuilder()
        sb.appendLine("/* eslint-disable */")
        sb.appendLine("/* Generated by SimpleRpc TypeScriptGenerator. Do not edit. */")
        sb.appendLine()
        sb.appendLine(
            "import type { CancelablePromise, RpcCallContext, RpcCallOptions, " +
                "RpcRegistration, SimpleRpcPeer } from \"${options.runtimeModule}\";",
        )
        sb.appendLine(
            "import { createProxy, registerService } from \"${options.runtimeModule}\";",
        )
        sb.appendLine()

        val allDtos = LinkedHashMap<String, String>()
        for (model in models) {
            for ((name, body) in model.dtoTypes) {
                allDtos.putIfAbsent(name, body)
            }
        }
        for (body in allDtos.values) {
            sb.appendLine(body)
            sb.appendLine()
        }

        for (model in models) {
            when (model.direction) {
                Direction.TS_CALL_KOTLIN -> emitTsCallKotlin(sb, model)
                Direction.KOTLIN_CALL_TS -> emitKotlinCallTs(sb, model)
            }
            sb.appendLine()
        }
        return sb.toString()
    }

    private fun emitTsCallKotlin(sb: StringBuilder, model: InterfaceModel) {
        val name = model.typeName
        sb.appendLine("export interface $name {")
        for (m in model.methods) {
            val params = m.params.joinToString(", ") { "${it.name}: ${it.tsType}" }
            val optsName = uniqueTrailingParamName(m.params, "options")
            val opts = "$optsName?: RpcCallOptions"
            val allParams = if (params.isEmpty()) opts else "$params, $opts"
            val ret = if (m.returnIsUnit) "void" else m.returnTs
            sb.appendLine("  ${tsPropertyKey(m.tsName)}($allParams): CancelablePromise<$ret>;")
        }
        sb.appendLine("}")
        sb.appendLine()
        sb.appendLine("export const ${name}Descriptor = {")
        sb.appendLine("  service: \"${escapeTsString(model.serviceName)}\",")
        sb.appendLine("  methods: {")
        for (m in model.methods) {
            sb.appendLine("    ${tsPropertyKey(m.tsName)}: { id: ${m.id}, arity: ${m.params.size} },")
        }
        sb.appendLine("  },")
        sb.appendLine("} as const;")
        sb.appendLine()
        sb.appendLine("export function create${name}Proxy(peer: SimpleRpcPeer): $name {")
        sb.appendLine("  return createProxy<$name>(peer, ${name}Descriptor);")
        sb.appendLine("}")
    }

    private fun emitKotlinCallTs(sb: StringBuilder, model: InterfaceModel) {
        val name = model.typeName
        val serviceName = "${name}Service"
        sb.appendLine("export interface $serviceName {")
        for (m in model.methods) {
            val params = m.params.joinToString(", ") { "${it.name}: ${it.tsType}" }
            val ctxName = uniqueTrailingParamName(m.params, "context")
            val ctx = "$ctxName?: RpcCallContext"
            val allParams = if (params.isEmpty()) ctx else "$params, $ctx"
            val ret = if (m.returnIsUnit) "void | Promise<void>" else "${m.returnTs} | Promise<${m.returnTs}>"
            sb.appendLine("  ${tsPropertyKey(m.tsName)}($allParams): $ret;")
        }
        sb.appendLine("}")
        sb.appendLine()
        sb.appendLine("export const ${name}Descriptor = {")
        sb.appendLine("  service: \"${escapeTsString(model.serviceName)}\",")
        sb.appendLine("  methods: {")
        for (m in model.methods) {
            sb.appendLine("    ${tsPropertyKey(m.tsName)}: { id: ${m.id}, arity: ${m.params.size} },")
        }
        sb.appendLine("  },")
        sb.appendLine("} as const;")
        sb.appendLine()
        sb.appendLine(
            "export function register${name}Service(" +
                "peer: SimpleRpcPeer, implementation: $serviceName): RpcRegistration {",
        )
        sb.appendLine("  return registerService(peer, ${name}Descriptor, implementation);")
        sb.appendLine("}")
    }

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

    /**
     * kotlinx.serialization marks nullable wrappers by appending '?' to [serialName].
     * Strip it so nested `Foo?` reuses the same TS type as `Foo`.
     */
    private fun nonNullSerialName(serialName: String): String = serialName.removeSuffix("?")

    private fun simpleSerialName(serialName: String): String {
        val cleaned = nonNullSerialName(serialName)
            .substringAfterLast('.')
            .substringAfterLast('/')
        return cleaned.ifEmpty {
            nonNullSerialName(serialName).replace(Regex("[^A-Za-z0-9_]"), "_")
        }
    }

    /**
     * Choose a trailing optional param name that does not collide with existing
     * method parameters (e.g. a Kotlin param already named `options`).
     */
    private fun uniqueTrailingParamName(params: List<ParamModel>, preferred: String): String {
        val taken = params.map { it.name }.toHashSet()
        if (preferred !in taken) return preferred
        var i = 2
        while ("$preferred$i" in taken) {
            i++
        }
        return "$preferred$i"
    }

    /** True when [name] is a valid TypeScript IdentifierName (ASCII subset). */
    private fun isValidTsIdentifier(name: String): Boolean {
        if (name.isEmpty()) return false
        if (name in TS_RESERVED_WORDS) return false
        val first = name[0]
        if (!(first == '_' || first == '$' || first.isLetter())) return false
        for (i in 1 until name.length) {
            val c = name[i]
            if (!(c == '_' || c == '$' || c.isLetterOrDigit())) return false
        }
        return true
    }

    /**
     * Emit a property/method key: bare identifier when valid, otherwise a quoted string.
     * Preserves wire/JSON keys such as `@SerialName("user-name")` and `@RpcFun(tsName=...)`.
     */
    private fun tsPropertyKey(name: String): String =
        if (isValidTsIdentifier(name)) name else "\"${escapeTsString(name)}\""

    /**
     * Produce a unique, valid TypeScript parameter identifier from [raw].
     * Illegal characters become `_`; reserved words and empty results get a safe fallback.
     */
    private fun uniqueSafeTsIdentifier(
        raw: String,
        taken: Set<String>,
        fallback: String,
    ): String {
        val base = sanitizeTsIdentifier(raw).ifEmpty { sanitizeTsIdentifier(fallback) }
            .ifEmpty { "arg" }
        if (base !in taken) return base
        var i = 2
        while ("$base$i" in taken) {
            i++
        }
        return "$base$i"
    }

    private fun sanitizeTsIdentifier(raw: String): String {
        if (isValidTsIdentifier(raw)) return raw
        val sb = StringBuilder(raw.length)
        for (c in raw) {
            when {
                c == '_' || c == '$' || c.isLetterOrDigit() -> sb.append(c)
                else -> sb.append('_')
            }
        }
        var result = sb.toString()
        if (result.isEmpty()) return ""
        val first = result[0]
        if (!(first == '_' || first == '$' || first.isLetter())) {
            result = "_$result"
        }
        if (result in TS_RESERVED_WORDS) {
            result = "_$result"
        }
        return result
    }

    private val TS_RESERVED_WORDS: Set<String> = setOf(
        "break", "case", "catch", "class", "const", "continue", "debugger", "default",
        "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for",
        "function", "if", "import", "in", "instanceof", "new", "null", "return", "super",
        "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with",
        "as", "implements", "interface", "let", "package", "private", "protected",
        "public", "static", "yield", "any", "boolean", "constructor", "declare", "get",
        "module", "require", "number", "set", "string", "symbol", "type", "from", "of",
        "async", "await", "namespace", "keyof", "readonly", "unique", "infer", "is",
        "asserts", "abstract", "override",
    )

    private fun escapeTsString(value: String): String =
        value.replace("\\", "\\\\").replace("\"", "\\\"")

    private fun fail(path: String, message: String): Nothing {
        throw IllegalArgumentException("TypeScript generation failed at $path: $message")
    }

    private fun boxedEquals(a: Class<*>, b: Class<*>): Boolean {
        fun box(c: Class<*>): Class<*> = when (c) {
            java.lang.Integer.TYPE -> Integer::class.java
            java.lang.Long.TYPE -> java.lang.Long::class.java
            java.lang.Boolean.TYPE -> java.lang.Boolean::class.java
            java.lang.Double.TYPE -> java.lang.Double::class.java
            java.lang.Float.TYPE -> java.lang.Float::class.java
            java.lang.Short.TYPE -> java.lang.Short::class.java
            java.lang.Byte.TYPE -> java.lang.Byte::class.java
            java.lang.Character.TYPE -> Character::class.java
            else -> c
        }
        return box(a) == box(b)
    }
}
