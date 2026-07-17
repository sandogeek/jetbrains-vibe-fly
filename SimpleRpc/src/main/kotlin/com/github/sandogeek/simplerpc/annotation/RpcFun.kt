package com.github.sandogeek.simplerpc.annotation

/**
 * Marks a method as an RPC entry point with a stable numeric id on the wire.
 *
 * Only methods annotated with this are part of the RPC contract; other interface
 * methods may be ordinary (non-suspend) helpers and are ignored by SimpleRpc.
 * Ids must be unique within the service interface.
 *
 * @param id Method id serialized as request field `i`.
 */
@MustBeDocumented
@Retention(AnnotationRetention.RUNTIME)
@Target(AnnotationTarget.FUNCTION)
annotation class RpcFun(val id: Int)
