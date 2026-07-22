import type { RpcCallOptions } from "./types.js"

/**
 * Cross-module stable brand for {@link rpcOptions}.
 * Must use Symbol.for so duplicate package copies in one JS realm still match.
 */
export const RPC_OPTIONS_BRAND = Symbol.for(
  "@sandogeek/simple-rpc/rpc-options",
)

/** Call options wrapped by {@link rpcOptions}; only these are stripped by proxies. */
export type BrandedRpcOptions = RpcCallOptions & {
  readonly [RPC_OPTIONS_BRAND]: typeof RPC_OPTIONS_BRAND
}

/** Create branded call options. Prefer this over a bare object on RPC proxy calls. */
export function rpcOptions(options: RpcCallOptions = {}): BrandedRpcOptions {
  return {
    ...options,
    [RPC_OPTIONS_BRAND]: RPC_OPTIONS_BRAND,
  }
}

/** Runtime check used by proxies (works across module copies via Symbol.for). */
export function isBrandedRpcOptions(value: unknown): value is BrandedRpcOptions {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }
  return (value as Record<symbol, unknown>)[RPC_OPTIONS_BRAND] === RPC_OPTIONS_BRAND
}
