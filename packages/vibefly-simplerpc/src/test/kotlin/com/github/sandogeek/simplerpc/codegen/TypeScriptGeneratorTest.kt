package com.github.sandogeek.simplerpc.codegen

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin
import java.nio.file.Files
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class TypeScriptGeneratorTest {

    @TsCallKotlin
    interface HostApi {
        @RpcFun(1)
        suspend fun getVersion(): String

        @RpcFun(2)
        suspend fun add(a: Int, b: Int): Int

        @RpcFun(3)
        suspend fun log(message: String)
    }

    @KotlinCallTs
    interface WebApi {
        @RpcFun(1)
        suspend fun greet(name: String): String

        @RpcFun(2)
        suspend fun notifyReady()
    }

    @TsCallKotlin
    interface EchoApi {
        @RpcFun(id = 1, tsName = "echoString")
        suspend fun echo(value: String): String

        @RpcFun(id = 2, tsName = "echoInt")
        suspend fun echo(value: Int): Int
    }

    @TsCallKotlin
    interface BadEchoApi {
        @RpcFun(1)
        suspend fun echo(value: String): String

        @RpcFun(2)
        suspend fun echo(value: Int): Int
    }

    @Serializable
    data class Foo(
        val name: String,
        val n: Int,
        @SerialName("display_name") val displayName: String? = null,
    )

    @Serializable
    data class NestedNullable(
        val strings: List<String?>,
        val foos: List<Foo?>,
        val byId: Map<String, String?>,
        val fooById: Map<String, Foo?>,
        val optionalList: List<String?>? = null,
    )

    @Serializable
    enum class Color { RED, GREEN }

    @TsCallKotlin
    interface GenericHostApi {
        @RpcFun(1)
        suspend fun listFoos(): List<Foo>

        @RpcFun(2)
        suspend fun mapFoos(input: Map<String, Foo>): Map<String, Foo>

        @RpcFun(3)
        suspend fun pairFoo(input: Pair<String, Foo>): Pair<String, Foo>

        @RpcFun(4)
        suspend fun paint(color: Color): Color

        @RpcFun(5)
        suspend fun maybeName(value: String?): String?

        @RpcFun(6)
        suspend fun nestedNullable(value: NestedNullable): NestedNullable
    }

    @Test
    fun generatesBidirectionalInterfaces() {
        val src = TypeScriptGenerator.generate(HostApi::class.java, WebApi::class.java)
        assertTrue(src.contains("export const hostApi = defineRpcService(\"HostApi\""))
        assertTrue(src.contains("export type HostApi = RpcClient<typeof hostApi>"))
        assertTrue(src.contains("export function createHostApiProxy"))
        assertTrue(src.contains("getVersion: rpcMethod<[], string>(1)"))
        assertTrue(src.contains("add: rpcMethod<[a: number, b: number], number>(2)"))
        assertTrue(src.contains("log: rpcMethod<[message: string], void>(3)"))
        assertFalse("must not emit arity:\n$src", src.contains("arity"))
        assertFalse("must not emit Descriptor:\n$src", src.contains("Descriptor"))

        assertTrue(src.contains("export const webApi = defineRpcService(\"WebApi\""))
        assertTrue(src.contains("export type WebApiService = RpcService<typeof webApi>"))
        assertTrue(src.contains("export function registerWebApiService"))
        assertTrue(src.contains("greet: rpcMethod<[name: string], string>(1)"))
        assertTrue(src.contains("from \"@sandogeek/simple-rpc\""))
        assertTrue(src.contains("defineRpcService"))
        assertTrue(src.contains("rpcMethod"))
        TypeScriptCompileSupport.assertCompiles(src, "HostApi+WebApi")
    }

    @Test
    fun tsNameOnOverloads() {
        val src = TypeScriptGenerator.generate(EchoApi::class.java)
        assertTrue("missing echoString id:\n$src", src.contains("echoString: rpcMethod<[value: string], string>(1)"))
        assertTrue("missing echoInt id:\n$src", src.contains("echoInt: rpcMethod<[value: number], number>(2)"))
        assertFalse("unexpected raw echo method key:\n$src", src.contains("  echo: rpcMethod"))
        TypeScriptCompileSupport.assertCompiles(src, "EchoApi")
    }

    @Test
    fun overloadWithoutTsNameFails() {
        try {
            TypeScriptGenerator.generate(BadEchoApi::class.java)
            fail("expected failure")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("tsName") || e.message!!.contains("Overloaded"))
        }
    }

    @Test
    fun dtoEnumCollectionMapPairSerialNameNullability() {
        val src = TypeScriptGenerator.generate(GenericHostApi::class.java)
        assertTrue(src.contains("export interface Foo"))
        assertTrue(src.contains("name: string"))
        assertTrue(src.contains("n: number"))
        assertTrue(src.contains("display_name?: string | null") || src.contains("display_name: string | null"))
        assertTrue(src.contains("export type Color = \"RED\" | \"GREEN\""))
        assertTrue(src.contains("listFoos: rpcMethod<[], Array<Foo>>(1)"))
        assertTrue(
            src.contains(
                "mapFoos: rpcMethod<[input: Record<string, Foo>], Record<string, Foo>>(2)",
            ),
        )
        assertTrue(
            src.contains(
                "pairFoo: rpcMethod<[input: [string, Foo]], [string, Foo]>(3)",
            ),
        )
        assertTrue(src.contains("paint: rpcMethod<[color: Color], Color>(4)"))
        assertTrue(
            src.contains(
                "maybeName: rpcMethod<[value: string | null], string | null>(5)",
            ),
        )
        assertTrue("missing NestedNullable:\n$src", src.contains("export interface NestedNullable"))
        assertTrue("List<String?> should be Array<string | null>:\n$src", src.contains("strings: Array<string | null>"))
        assertTrue("List<Foo?> should be Array<Foo | null>:\n$src", src.contains("foos: Array<Foo | null>"))
        assertTrue(
            "Map value String? should be Record<string, string | null>:\n$src",
            src.contains("byId: Record<string, string | null>"),
        )
        assertTrue(
            "Map value Foo? should be Record<string, Foo | null>:\n$src",
            src.contains("fooById: Record<string, Foo | null>"),
        )
        assertTrue(
            "List<String?>? should be Array<string | null> | null:\n$src",
            src.contains("optionalList?: Array<string | null> | null") ||
                src.contains("optionalList: Array<string | null> | null"),
        )
        assertFalse("must not emit arity:\n$src", src.contains("arity"))
        TypeScriptCompileSupport.assertCompiles(src, "GenericHostApi")
    }

    @Test
    fun deterministicOutput() {
        val a = TypeScriptGenerator.generate(HostApi::class.java, WebApi::class.java)
        val b = TypeScriptGenerator.generate(HostApi::class.java, WebApi::class.java)
        assertEquals(a, b)
    }

    @Test
    fun customRuntimeModule() {
        val src = TypeScriptGenerator.generate(
            listOf(HostApi::class.java),
            TypeScriptGenerationOptions(runtimeModule = "./runtime.js"),
        )
        assertTrue(src.contains("from \"./runtime.js\""))
    }

    @Test
    fun generateToWritesFile() {
        val dir = Files.createTempDirectory("simplerpc-ts-gen")
        val out = dir.resolve("rpc.ts")
        TypeScriptGenerator.generateTo(out, HostApi::class.java)
        val text = Files.readString(out)
        assertTrue(text.contains("export const hostApi = defineRpcService"))
        assertTrue(text.contains("export type HostApi = RpcClient"))
        assertFalse(text.contains("arity"))
    }

    @TsCallKotlin("CustomHost")
    interface NamedHost {
        @RpcFun(1)
        suspend fun ping(): String
    }

    @TsCallKotlin
    interface OptionsParamApi {
        @RpcFun(1)
        suspend fun save(options: String): String

        @RpcFun(2)
        suspend fun saveBoth(options: String, options2: Int): String
    }

    @KotlinCallTs
    interface ContextParamApi {
        @RpcFun(1)
        suspend fun handle(context: String): String
    }

    @Test
    fun serviceNameFromAnnotationValue() {
        val src = TypeScriptGenerator.generate(NamedHost::class.java)
        assertTrue(src.contains("defineRpcService(\"CustomHost\""))
        assertTrue(src.contains("export type NamedHost = RpcClient"))
        TypeScriptCompileSupport.assertCompiles(src, "NamedHost")
    }

    @Test
    fun paramsNamedOptionsRemainBusinessArgs() {
        val src = TypeScriptGenerator.generate(OptionsParamApi::class.java)
        assertTrue(
            "options param must remain in args tuple:\n$src",
            src.contains("save: rpcMethod<[options: string], string>(1)"),
        )
        assertTrue(
            "options and options2 params must remain:\n$src",
            src.contains(
                "saveBoth: rpcMethod<[options: string, options2: number], string>(2)",
            ),
        )
        assertFalse(src.contains("arity"))
        TypeScriptCompileSupport.assertCompiles(src, "OptionsParamApi")
    }

    @Test
    fun paramsNamedContextRemainBusinessArgs() {
        val src = TypeScriptGenerator.generate(ContextParamApi::class.java)
        assertTrue(
            "context param must remain in args tuple:\n$src",
            src.contains("handle: rpcMethod<[context: string], string>(1)"),
        )
        assertFalse(src.contains("arity"))
        TypeScriptCompileSupport.assertCompiles(src, "ContextParamApi")
    }

    @Test
    fun generatedCodeCompilesWithTsc() {
        val src = TypeScriptGenerator.generate(
            HostApi::class.java,
            WebApi::class.java,
            EchoApi::class.java,
            GenericHostApi::class.java,
            NamedHost::class.java,
            OptionsParamApi::class.java,
            ContextParamApi::class.java,
            IllegalIdentApi::class.java,
            IllegalIdentWebApi::class.java,
        )
        TypeScriptCompileSupport.assertCompiles(src, "all-fixtures")
    }

    @Serializable
    data class KebabDto(
        @SerialName("user-name") val userName: String,
        @SerialName("1st") val first: Int,
    )

    @TsCallKotlin
    interface IllegalIdentApi {
        @RpcFun(id = 1, tsName = "get-user")
        suspend fun getUser(value: KebabDto): KebabDto

        @RpcFun(id = 2, tsName = "do")
        suspend fun doAction(`class`: String, `user-name`: Int): String
    }

    @KotlinCallTs
    interface IllegalIdentWebApi {
        @RpcFun(id = 1, tsName = "on-ready")
        suspend fun onReady(`default`: String)
    }

    @Test
    fun illegalIdentifiersQuotedOrRenamed() {
        val src = TypeScriptGenerator.generate(
            IllegalIdentApi::class.java,
            IllegalIdentWebApi::class.java,
        )
        assertTrue("DTO field user-name must be quoted:\n$src", src.contains("\"user-name\": string"))
        assertTrue("DTO field 1st must be quoted:\n$src", src.contains("\"1st\": number"))
        assertTrue("method get-user must be quoted:\n$src", src.contains("\"get-user\""))
        assertTrue("method do must be quoted:\n$src", src.contains("\"do\""))
        assertTrue("descriptor key on-ready must be quoted:\n$src", src.contains("\"on-ready\""))
        assertTrue(
            "reserved param class must be renamed:\n$src",
            src.contains("_class: string") || src.contains("class_: string"),
        )
        assertTrue(
            "illegal param user-name must be sanitized:\n$src",
            src.contains("user_name: number"),
        )
        assertTrue(
            "reserved param default must be renamed:\n$src",
            src.contains("_default: string") || src.contains("default_: string"),
        )
        assertFalse("raw class param must not appear:\n$src", src.contains("(class: string"))
        assertFalse("raw user-name param must not appear:\n$src", src.contains("user-name: number"))
        TypeScriptCompileSupport.assertCompiles(src, "IllegalIdent")
    }
}
