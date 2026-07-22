import {type BrandedRpcOptions} from "./options.js"
import {
  createProxy as createProxyFromDescriptor,
  registerService as registerServiceFromDescriptor,
  type SimpleRpcPeer,
} from "./peer.js"
import type {CancelablePromise, RpcCallContext, RpcRegistration, RpcServiceDescriptor,} from "./types.js"

/** Internal method definition produced by {@link rpcMethod}. */
export type RpcMethodDef<
  Args extends readonly unknown[] = readonly unknown[],
  Result = unknown,
> = {
  readonly id: number
  readonly __args?: Args
  readonly __result?: Result
}

/**
 * Extract business arguments from a direct contract method.
 *
 * A direct contract may expose the branded RPC options as its final optional
 * argument. Those options configure the local call and must not be serialized
 * as a wire argument.
 */
export type RpcMethodArgs<Method> = Method extends (
  ...args: [...infer Args, options?: BrandedRpcOptions]
) => unknown
  ? Args
  : Method extends (...args: infer Args) => unknown
    ? Args
    : never

/**
 * Declare a service method with a stable wire id.
 * Args/Result exist only for type inference; they never appear on the wire.
 */
export function rpcMethod<
  Args extends readonly unknown[] = [],
  Result = unknown,
>(id: number): RpcMethodDef<Args, Result> {
  if (!Number.isInteger(id) || id < 0) {
    throw new Error(`rpcMethod id must be a non-negative integer, got ${String(id)}`)
  }
  return { id }
}

type AnyMethods = Record<string, RpcMethodDef>

/** Client API derived from a service definition. */
export type RpcClient<Def extends RpcServiceDefinition<AnyMethods>> = {
  [K in keyof Def["methods"]]: Def["methods"][K] extends RpcMethodDef<
    infer Args,
    infer Result
  >
    ? (
        ...args: [...Args, options?: BrandedRpcOptions]
      ) => CancelablePromise<Result extends void ? void : Result>
    : never
}

/** Server implementation API derived from a service definition. */
export type RpcService<Def extends RpcServiceDefinition<AnyMethods>> = {
  [K in keyof Def["methods"]]: Def["methods"][K] extends RpcMethodDef<
    infer Args,
    infer Result
  >
    ? (
        ...args: [...Args, context?: RpcCallContext]
      ) => Result | Promise<Result>
    : never
}

export type RpcServiceDefinition<Methods extends AnyMethods> = {
  readonly name: string
  readonly methods: Methods
  /** @internal wire descriptor — not part of the public contract surface */
  readonly descriptor: RpcServiceDescriptor
  createProxy(peer: SimpleRpcPeer): RpcClient<RpcServiceDefinition<Methods>>
  register(
    peer: SimpleRpcPeer,
    implementation: RpcService<RpcServiceDefinition<Methods>>,
  ): RpcRegistration
}

/**
 * Define an RPC service once; derive client/server types and create/register helpers.
 */
export function defineRpcService<const Methods extends AnyMethods>(
  name: string,
  methods: Methods,
): RpcServiceDefinition<Methods> {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("defineRpcService requires a non-empty service name")
  }
  const seenIds = new Map<number, string>()
  const descriptorMethods: Record<string, number> = {}
  for (const [methodName, def] of Object.entries(methods)) {
    if (def == null || typeof def.id !== "number") {
      throw new Error(
        `defineRpcService(${name}): method ${methodName} must be created with rpcMethod(id)`,
      )
    }
    const prev = seenIds.get(def.id)
    if (prev != null) {
      throw new Error(
        `defineRpcService(${name}): duplicate method id ${def.id} for ${prev} and ${methodName}`,
      )
    }
    seenIds.set(def.id, methodName)
    descriptorMethods[methodName] = def.id
  }

  const descriptor: RpcServiceDescriptor = {
    service: name,
    methods: descriptorMethods,
  }

  return {
    name,
    methods,
    descriptor,
    createProxy(peer: SimpleRpcPeer) {
      return createProxyFromDescriptor(
          peer,
          descriptor,
      ) as RpcClient<RpcServiceDefinition<Methods>>
    },
    register(peer, implementation) {
      return registerServiceFromDescriptor(
          peer,
          descriptor,
          implementation as object,
      )
    },
  }
}
