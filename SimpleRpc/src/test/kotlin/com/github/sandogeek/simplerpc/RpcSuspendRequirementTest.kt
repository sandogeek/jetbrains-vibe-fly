package com.github.sandogeek.simplerpc

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin
import org.junit.Assert.assertThrows
import org.junit.Test

class RpcSuspendRequirementTest {

    @Test
    fun nonSuspendMethod_fails() {
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

    @TsCallKotlin
    interface BadApi {
        fun notSuspend(): String
        suspend fun ok(): Int
    }

    @KotlinCallTs
    interface GoodTsApi {
        suspend fun ping()
    }

    @TsCallKotlin
    interface GoodKotlinApi {
        suspend fun getAppVersion(): String
        suspend fun logFromWeb(message: String)
    }

    interface PlainApi {
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
}
