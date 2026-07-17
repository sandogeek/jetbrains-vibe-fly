package com.github.sandogeek.simplerpc.internal

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.TsCallKotlin

internal object ServiceName {
    fun of(iface: Class<*>): String {
        val ts = iface.getAnnotation(TsCallKotlin::class.java)
        if (ts != null) {
            return ts.value.ifEmpty { iface.simpleName }
        }
        val kt = iface.getAnnotation(KotlinCallTs::class.java)
        if (kt != null) {
            return kt.value.ifEmpty { iface.simpleName }
        }
        return iface.simpleName
    }
}
