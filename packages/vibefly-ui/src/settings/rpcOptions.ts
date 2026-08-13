import { rpcOptions } from "@sandogeek/simple-rpc"

// Kotlin allows 60s for provider work; leave room for host→agent RPC overhead.
// Kotlin 侧 Provider 工作允许 60s；为 host→agent RPC 开销留余量。
export const PROVIDER_CONFIG_RPC_OPTIONS = rpcOptions({ timeoutMs: 70_000 })

// Browser OAuth is allowed to wait up to 6 minutes on the host.
// 浏览器 OAuth 在 Host 侧最多可等待 6 分钟。
export const PROVIDER_LOGIN_RPC_OPTIONS = rpcOptions({ timeoutMs: 370_000 })
