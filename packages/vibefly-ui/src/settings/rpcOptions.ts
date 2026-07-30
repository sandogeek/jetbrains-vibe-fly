import { rpcOptions } from "@sandogeek/simple-rpc"

// Kotlin allows 60s for provider work; leave room for host→agent RPC overhead.
export const PROVIDER_CONFIG_RPC_OPTIONS = rpcOptions({ timeoutMs: 70_000 })

// Browser OAuth is allowed to wait up to 6 minutes on the host.
export const PROVIDER_LOGIN_RPC_OPTIONS = rpcOptions({ timeoutMs: 370_000 })
