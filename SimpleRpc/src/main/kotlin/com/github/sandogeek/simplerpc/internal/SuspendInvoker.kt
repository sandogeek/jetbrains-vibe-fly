package com.github.sandogeek.simplerpc.internal

import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType
import kotlin.coroutines.intrinsics.suspendCoroutineUninterceptedOrReturn

/**
 * Reflectively invokes a Kotlin `suspend` method (last parameter is Continuation).
 */
internal object SuspendInvoker {

    suspend fun invoke(instance: Any, method: Method, args: Array<Any?>): Any? {
        return try {
            suspendCoroutineUninterceptedOrReturn { cont ->
                val fullArgs = arrayOfNulls<Any?>(args.size + 1)
                System.arraycopy(args, 0, fullArgs, 0, args.size)
                fullArgs[args.size] = cont
                method.invoke(instance, *fullArgs)
            }
        } catch (e: InvocationTargetException) {
            throw e.targetException ?: e
        }
    }

    fun rpcParameterTypes(method: Method): Array<Type> {
        val params = method.genericParameterTypes
        if (params.isEmpty()) return emptyArray()
        return Array(params.size - 1) { params[it] }
    }

    /**
     * Suspend methods compile to Continuation&lt;? super T&gt;. Resolve the real return type T,
     * preserving nested generics (e.g. List&lt;Foo&gt;).
     */
    fun rpcReturnType(method: Method): Type {
        val params = method.genericParameterTypes
        if (params.isNotEmpty()) {
            val last = params.last()
            if (last is ParameterizedType) {
                val typeArgs = last.actualTypeArguments
                if (typeArgs.isNotEmpty()) {
                    return unwrapContinuationArg(typeArgs[0])
                }
            }
        }
        return method.genericReturnType
    }

    private fun unwrapContinuationArg(type: Type): Type {
        return when (type) {
            is WildcardType -> {
                val lower = type.lowerBounds.firstOrNull()
                if (lower != null) return unwrapContinuationArg(lower)
                val upper = type.upperBounds.firstOrNull { it != Any::class.java }
                    ?: type.upperBounds.firstOrNull()
                if (upper != null) return unwrapContinuationArg(upper)
                type
            }
            is Class<*> -> when {
                type == Void::class.java || type == Void.TYPE -> Unit::class.java
                else -> type
            }
            else -> type
        }
    }

    fun isRpcCandidate(method: Method): Boolean = RpcSuspendRequirement.isRpcCandidate(method)
}
