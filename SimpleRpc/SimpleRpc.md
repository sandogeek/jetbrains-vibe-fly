# SimpleRpc

Kotlin/JVM 与 TypeScript 之间的双向 RPC 桥。契约、生成器、取消/超时语义与传输层分离。

| 场景 | Kotlin transport | TypeScript |
|------|------------------|------------|
| JCEF WebView ↔ 插件 | `CefMessageRouterTransport` | `@sandogeek/simple-rpc` → `createCefSimpleRpc` |
| Node/Bun 子进程 ↔ 插件 | `StdioRpcTransport` | `@sandogeek/simple-rpc-bun` → `createStdioSimpleRpc` |

JCEF：CefMessageRouter（TS → Kotlin）+ executeJavaScript / DOM CustomEvent（Kotlin → TS）。  
stdio：子进程 `stdin`/`stdout` 上 **Content-Length** 分帧 UTF-8 JSON；`stdout` 仅承载协议，日志写 `stderr`。

## 破坏性变更（ESM 契约）

- **不再**提供 `window.SimpleRpc`、内嵌 `JS_BRIDGE_SOURCE` 或 `window.__simpleRpcOnHostMessage`。
- 前端必须显式 `import` `@sandogeek/simple-rpc`，调用 `createCefSimpleRpc`，并用生成代码创建代理 / 注册服务。
- Kotlin → 页面通过固定事件名 `simplerpc:host-message` 的 `CustomEvent` 投递；**初始化前到达的 host 事件不缓存**。
- 插件侧只负责配置 `CefMessageRouter` 与创建 Kotlin `RpcSession`，不再注入桥接脚本。

## 目标

- 用 Kotlin `interface` 描述 RPC 契约，并通过 `TypeScriptGenerator` 生成 TypeScript 契约
- 仅 `@RpcFun` 方法进入 RPC 契约，且必须是 `suspend`；接口内可保留常规方法
- 运行时校验契约，避免漏 `@RpcFun` / 非 suspend / 重复 id 进入注册或代理
- 通过 `RpcSession`（Kotlin）与 `SimpleRpcPeer`（TS）完成注册、代理与请求分发

## 方向

| 注解 | 实现所在 | 调用方 | 含义 |
|------|----------|--------|------|
| `@TsCallKotlin` | Kotlin/JVM | TypeScript | WebView 调宿主能力 |
| `@KotlinCallTs` | TypeScript | Kotlin | 宿主调 WebView 逻辑 |

可选参数 `value`：线上 service 名；默认取接口 simple name。

## 契约规则

1. 目标类型必须是 **interface**
2. 必须标注 `@TsCallKotlin` 或 `@KotlinCallTs`
3. **RPC 方法**必须标注 `@RpcFun(id)`，且必须是 `suspend`；id 在同一接口内不可重复
4. 同名重载生成 TS 时必须配置唯一 `@RpcFun(tsName = "...")`（线协议仍只用数字 id）
5. 未标注 `@RpcFun` 的方法视为常规方法，不参与 RPC（可为非 suspend）
6. 忽略 `equals` / `hashCode` / `toString` 以及 synthetic、bridge、static 方法
7. 接口至少声明一个 `@RpcFun` 方法

不满足时 `SimpleRpc.requireSuspendMethods` 抛出 `IllegalArgumentException`。

## 模块结构

```
SimpleRpc/
├── SimpleRpc.md
├── plan.md
├── build.gradle.kts
├── typeScript/                 # @sandogeek/simple-rpc（浏览器 / JCEF，无 Node 依赖）
│   ├── package.json
│   └── src/
├── typeScript-bun/             # @sandogeek/simple-rpc-bun（stdio + Content-Length framing）
│   ├── package.json
│   └── src/
└── src/
    ├── main/kotlin/com/github/sandogeek/simplerpc/
    │   ├── SimpleRpc.kt
    │   ├── RpcSession.kt
    │   ├── annotation/
    │   ├── codegen/            # TypeScriptGenerator
│   ├── transport/
│   ├── protocol/
│   ├── jcef/               # CefMessageRouterTransport
│   ├── stdio/              # StdioRpcTransport + Content-Length framing
│   └── internal/
    └── test/kotlin/...
```

依赖：`kotlin-stdlib`、`kotlin-reflect`、`kotlinx-coroutines-core`、`kotlinx-serialization-json`。JVM 21。

本模块**不**依赖 IntelliJ / JCEF API，便于单测；插件侧把 `CefMessageRouter` 接到 `CefMessageRouterTransport`，或把子进程 stdio 接到 `StdioRpcTransport`。

TS 包构建仅产出 ESM JavaScript、类型声明和 source map，不向 Kotlin JAR 打包 JS。

## stdio 分帧

```
Content-Length: <utf8-byte-count>\r\n
\r\n
<utf-8 json body>
```

不依赖换行分割消息体。示例：

```kotlin
val process = ProcessBuilder("node", "agent.js")
    .redirectError(ProcessBuilder.Redirect.INHERIT)
    .start()
val transport = StdioRpcTransport(
    input = process.inputStream,
    output = process.outputStream,
    onClosed = { process.destroy() }, // 可选：额外清理
)
// stdin/stdout EOF 时 transport 关闭，RpcSession 自动 close 并立即失败挂起请求
val session = SimpleRpc.open(transport)
```

```ts
import { createStdioSimpleRpc } from "@sandogeek/simple-rpc-bun"

// Node 作为子进程时：
// input EOF 时 peer 自动 close，未完成的 call（含 timeoutMs: 0）立即 reject
const rpc = createStdioSimpleRpc({
  input: process.stdin,
  output: process.stdout,
})
```

## 线协议

JSON 信封（不变）：

```json
// 请求（按方法 id）
{"t":"req","id":"<uuid>","s":"HostApi","i":1,"a":[]}

// 成功响应
{"t":"ok","id":"<uuid>","r":"1.0.0"}

// 失败响应
{"t":"err","id":"<uuid>","e":"error message"}

// 取消
{"t":"cancel","id":"<uuid>"}
```

| 字段 | 含义 |
|------|------|
| `t` | `req` / `ok` / `err` / `cancel` |
| `id` | 请求关联 id |
| `s` | service（注解 `value` 或 simple name） |
| `i` | 方法 id（`@RpcFun`），分发唯一键 |
| `a` | 参数数组（JSON） |
| `r` | 成功结果（仅 `t=ok`） |
| `e` | 错误信息（仅 `t=err`） |

## 用法

### 1. 定义接口

```kotlin
@TsCallKotlin
interface HostApi {
    @RpcFun(1)
    suspend fun getAppVersion(): String

    @RpcFun(2)
    suspend fun logFromWeb(message: String)

    @RpcFun(id = 3, tsName = "echoString")
    suspend fun echo(value: String): String

    @RpcFun(id = 4, tsName = "echoInt")
    suspend fun echo(value: Int): Int
}

@KotlinCallTs
interface WebApi {
    @RpcFun(1)
    suspend fun notifyReady()

    @RpcFun(2)
    suspend fun greet(name: String): String
}
```

### 2. 生成 TypeScript 契约

```kotlin
import com.github.sandogeek.simplerpc.codegen.TypeScriptGenerator
import com.github.sandogeek.simplerpc.codegen.TypeScriptGenerationOptions
import java.nio.file.Path

TypeScriptGenerator.generateTo(
    Path.of("web/src/generated/rpc.ts"),
    listOf(HostApi::class.java, WebApi::class.java),
    TypeScriptGenerationOptions(runtimeModule = "@sandogeek/simple-rpc"),
)
```

生成内容（示意）：

- `@TsCallKotlin` → `HostApi`、`HostApiDescriptor`、`createHostApiProxy(peer)`
- `@KotlinCallTs` → `WebApiService`、`WebApiDescriptor`、`registerWebApiService(peer, impl)`

### 3. 插件侧接线 CefMessageRouter

```kotlin
import com.github.sandogeek.simplerpc.SimpleRpc
import com.github.sandogeek.simplerpc.jcef.CefMessageRouterTransport
import com.intellij.ui.jcef.JBCefBrowser
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.browser.CefMessageRouter
import org.cef.browser.CefMessageRouter.CefMessageRouterConfig
import org.cef.callback.CefQueryCallback
import org.cef.handler.CefMessageRouterHandlerAdapter

val browser = JBCefBrowser()

val transport = CefMessageRouterTransport { script ->
    browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
}
// requestTimeout 默认 30s；Duration.INFINITE 关闭超时
val session = SimpleRpc.open(transport)

session.registerImplementation(object : HostApi {
    override suspend fun getAppVersion() = "0.0.1"
    override suspend fun logFromWeb(message: String) { /* ... */ }
    override suspend fun echo(value: String) = value
    override suspend fun echo(value: Int) = value
})
val webApi = session.proxy<WebApi>()

val config = CefMessageRouterConfig(
    CefMessageRouterTransport.JS_QUERY_FUNCTION,   // "cefQuery"
    CefMessageRouterTransport.JS_CANCEL_FUNCTION,  // "cefQueryCancel"
)
val router = CefMessageRouter.create(config)
router.addHandler(object : CefMessageRouterHandlerAdapter() {
    override fun onQuery(
        browser: CefBrowser,
        frame: CefFrame,
        queryId: Long,
        request: String,
        persistent: Boolean,
        callback: CefQueryCallback,
    ): Boolean = transport.handleQuery(
        queryId,
        request,
        onSuccess = { callback.success(it) },
        onFailure = { code, msg -> callback.failure(code, msg) },
    )

    override fun onQueryCanceled(
        browser: CefBrowser,
        frame: CefFrame,
        queryId: Long,
    ) {
        transport.handleQueryCanceled(queryId)
    }
}, true)
browser.jbCefClient.cefClient.addMessageRouter(router)
// 不再注入 JS 桥；前端 ESM 自行 createCefSimpleRpc
```

### 4. TypeScript 侧

```ts
import {
  createCefSimpleRpc,
} from "@sandogeek/simple-rpc"
import {
  createHostApiProxy,
  registerWebApiService,
} from "./generated/rpc"

const rpc = createCefSimpleRpc({
  query: window.cefQuery,
  cancelQuery: window.cefQueryCancel,
})

const hostApi = createHostApiProxy(rpc)
const version = await hostApi.getAppVersion()
const p = hostApi.logFromWeb("hi", { timeoutMs: 5000 })
p.cancel()

registerWebApiService(rpc, {
  async greet(name) {
    return `hello ${name}`
  },
  async notifyReady() {},
})
```

页面须在 Kotlin 发起调用前完成 `createCefSimpleRpc()`；`Long` 映射为 TS `number`，调用方负责限制在 JS 安全整数范围。

## 校验（可选，注册/代理时也会校验）

```kotlin
SimpleRpc.requireSuspendMethods<HostApi>()
```

## 设计原则

- **接口即契约**：`@RpcFun` 标记 RPC 入口与方法 id；生成器产出 TS 代理/服务类型
- **RPC 全 suspend**：跨 WebView 边界天然异步
- **先校验后接线**：proxy / 注册入口统一调用 `requireSuspendMethods`
- **契约与传输分离**：核心只依赖 `RpcTransport`；JCEF 适配在 `jcef` 包
- **CefMessageRouter 职责**：TS→Kotlin 走 `cefQuery`；Kotlin→TS 走 `CustomEvent(simplerpc:host-message)`

## 测试

```bash
# Kotlin（需 JDK 21）
./gradlew :SimpleRpc:test

# TypeScript（浏览器 / JCEF 核心）
cd SimpleRpc/typeScript && bun install --frozen-lockfile && bun test && bun run build

# TypeScript（Bun/Node stdio）
cd SimpleRpc/typeScript-bun && bun install --frozen-lockfile && bun test && bun run build
```

## 超时与取消

| 场景 | 行为 |
|------|------|
| 出站超时 | Kotlin 默认 30s → `RpcTimeoutException`，并向对端发 `cancel` |
| 调用方 `Job` 取消 | 清本地 pending，发 `cancel`；对端取消 inbound Job |
| 入站 `cancel` | 取消正在执行的分发，不回 `ok`/`err` |
| TS `call` 超时 / `.cancel()` / `AbortSignal` | 发 `cancel` + 必需的 `cefQueryCancel`（关闭 native query） |
| CEF `onQueryCanceled` | 映射 queryId → requestId，注入 `cancel` 取消 Kotlin Job |
| 仅 wire `cancel`（无 cefQueryCancel） | Kotlin 在 `handleQuery` 中关闭对应 open callback，避免 query 泄漏 |
| 页面未初始化 / 响应丢失 | 出站侧靠超时兜底 |

`createCefSimpleRpc` 要求 `cancelQuery` 与 `query` 返回数字 `queryId`。  
`CefMessageRouterTransport.handleQuery(queryId, …)` 在收到 `req` 时保持 query 打开，直到对应 `ok`/`err`/`cancel` 写出；收到 wire `cancel` 时也会主动 `onFailure(1, "cancelled")` 关闭原 callback。

## 序列化类型

反射层使用 `java.lang.reflect.Type` + Kotlin reflection（参数名 / nullability），DTO 经 kotlinx-serialization `SerialDescriptor` 生成 TS 类型。

支持：基础类型、集合、`Map<String, T>`、`Pair`、`@Serializable` DTO、`@SerialName`、枚举。

严格失败：多态、上下文 serializer、未具体化泛型、非字符串 Map key、声明重名等（错误信息含完整类型路径）。

DTO 仍需 `@Serializable`。`Long` → TS `number`。
