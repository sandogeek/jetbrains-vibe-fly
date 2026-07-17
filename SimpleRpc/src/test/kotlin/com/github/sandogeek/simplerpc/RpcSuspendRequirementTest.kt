package com.github.sandogeek.simplerpc

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.RpcFun
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin
import org.junit.Assert.assertThrows
import org.junit.Test

class RpcSuspendRequirementTest {

    @Test
    fun nonSuspendRpcFun_fails() {
        assertThrows(IllegalArgumentException::class.java) {
            SimpleRpc.requireSuspendMethods(BadApi::class.java)
        }
    }

    @Test
    fun missingAnnotation_fails() {
        assertThrows(IllegalArgumentException::class.java) {
            SimpleRpc.requireSuspendMethods(PlainApi::class.java)
        }
    }

    @Test
    fun noRpcFunMethods_fails() {
        assertThrows(IllegalArgumentException::class.java) {
            SimpleRpc.requireSuspendMethods(NoRpcFunApi::class.java)
        }
    }

    @Test
    fun duplicateRpcFunId_fails() {
        assertThrows(IllegalArgumentException::class.java) {
            SimpleRpc.requireSuspendMethods(DuplicateIdApi::class.java)
        }
    }

    @TsCallKotlin
    interface BadApi {
        @RpcFun(1)
        fun notSuspend(): String

        @RpcFun(2)
        suspend fun ok(): Int
    }

    @KotlinCallTs
    interface GoodTsApi {
        @RpcFun(1)
        suspend fun ping()
    }

    @TsCallKotlin
    interface GoodKotlinApi {
        @RpcFun(1)
        suspend fun getAppVersion(): String

        @RpcFun(2)
        suspend fun logFromWeb(message: String)

        /** Ordinary helper — not part of the RPC contract. */
        fun localHelper(): String
    }

    @TsCallKotlin
    interface NoRpcFunApi {
        suspend fun notExported(): String
        fun ordinary(): Int
    }

    @TsCallKotlin
    interface DuplicateIdApi {
        @RpcFun(1)
        suspend fun a(): String

        @RpcFun(1)
        suspend fun b(): String
    }

    @TsCallKotlin
    interface SameNameWithIdApi {
        @RpcFun(1)
        suspend fun echo(value: String): String

        @RpcFun(2)
        suspend fun echo(value: Int): Int
    }

    interface PlainApi {
        @RpcFun(1)
        suspend fun ok()
    }

    @Test
    fun goodTsApi_passes() {
        SimpleRpc.requireSuspendMethods(GoodTsApi::class.java)
    }

    @Test
    fun goodKotlinApi_passes() {
        SimpleRpc.requireSuspendMethods(GoodKotlinApi::class.java)
    }

    @Test
    fun sameNameWithRpcFun_passes() {
        SimpleRpc.requireSuspendMethods(SameNameWithIdApi::class.java)
    }
}
