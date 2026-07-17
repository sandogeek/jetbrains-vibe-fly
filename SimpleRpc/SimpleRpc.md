# SimpleRpc

JCEF WebView（TypeScript）与 Kotlin/JVM 之间的双向 RPC 桥。用于 IntelliJ 插件内：界面跑在 JCEF，业务在 Kotlin，双方通过接口约定互相调用。

传输层基于 **CefMessageRouter**（TS → Kotlin）与 **executeJavaScript**（Kotlin → TS）。

> 与 Node 侧 ClineSdk 的通讯走 gRPC；**界面 ↔ Kotlin** 走本模块。

## 目标

- 用 Kotlin `interface` 描述 RPC 契约，两端类型对齐
- 仅 `@RpcFun` 方法进入 RPC 契约，且必须是 `suspend`；接口内可保留常规方法
- 运行时校验契约，避免漏 `@RpcFun` / 非 suspend / 重复 id 进入注册或代理
- 通过 `RpcSession` 完成注册、代理与请求分发

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
4. 未标注 `@RpcFun` 的方法视为常规方法，不参与 RPC（可为非 suspend）
5. 忽略 `equals` / `hashCode` / `toString` 以及 synthetic、bridge、static 方法
6. 接口至少声明一个 `@RpcFun` 方法

不满足时 `SimpleRpc.requireSuspendMethods` 抛出 `IllegalArgumentException`。

## 模块结构

```
SimpleRpc/
├── SimpleRpc.md
├── build.gradle.kts
└── src/
    ├── main/kotlin/com/github/sandogeek/simplerpc/
    │   ├── SimpleRpc.kt
    │   ├── RpcSession.kt
    │   ├── annotation/
    │   │   ├── KotlinCallTs.kt
    │   │   ├── TsCallKotlin.kt
    │   │   └── RpcFun.kt
    │   ├── transport/
    │   │   └── RpcTransport.kt
    │   ├── protocol/              # 线协议 JSON
    │   ├── jcef/
    │   │   └── CefMessageRouterTransport.kt
    │   └── internal/
    └── test/kotlin/...
```

依赖：`kotlin-stdlib`、`kotlinx-coroutines-core`、`kotlinx-serialization-json`。JVM 21。

本模块**不**依赖 IntelliJ / JCEF API，便于单测；插件侧把 `CefMessageRouter` 接到 `CefMessageRouterTransport`。

## 线协议

JSON 信封：

```json
// 请求（按方法 id）
{"t":"req","id":"<uuid>","s":"HostApi","i":1,"a":[]}

// 成功响应
{"t":"res","id":"<uuid>","ok":true,"r":"1.0.0"}

// 失败响应
{"t":"res","id":"<uuid>","ok":false,"e":"error message"}

// 取消（调用方超时 / Job 取消 / Promise.cancel / cefQueryCancel）
{"t":"cancel","id":"<uuid>"}
```

| 字段 | 含义 |
|------|------|
| `t` | `req` / `res` / `cancel` |
| `id` | 请求关联 id |
| `s` | service（注解 `value` 或 simple name） |
| `i` | 方法 id（`@RpcFun`），分发唯一键 |
| `a` | 参数数组（JSON） |
| `r` / `e` | 结果 / 错误信息 |

## 用法

### 1. 定义接口

```kotlin
@TsCallKotlin
interface HostApi {
    @RpcFun(1)
    suspend fun getAppVersion(): String

    @RpcFun(2)
    suspend fun logFromWeb(message: String)

    // 同名方法：不同 id
    @RpcFun(3)
    suspend fun echo(value: String): String

    @RpcFun(4)
    suspend fun echo(value: Int): Int

    // 常规方法：不参与 RPC
    fun localHelper(): String = "local"
}

@KotlinCallTs
interface WebApi {
    @RpcFun(1)
    suspend fun notifyReady()

    @RpcFun(2)
    suspend fun greet(name: String): String
}
```

### 2. 插件侧接线 CefMessageRouter

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
})
// 或 session.register(HostApi::class.java, impl) / session.register<HostApi>(impl)
// registerImplementation 要求恰好一个 @TsCallKotlin 接口；多个时抛错，须用显式 register
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

// 注入 JS 桥（或把 JS_BRIDGE_SOURCE 打进前端 bundle）
browser.cefBrowser.executeJavaScript(
    CefMessageRouterTransport.JS_BRIDGE_SOURCE,
    browser.cefBrowser.url,
    0,
)
```

### 3. TypeScript 侧

页面加载后需具备 `window.cefQuery`（由 CefMessageRouter 注入）以及 `JS_BRIDGE_SOURCE` 中的 `window.SimpleRpc`。

```ts
// TS → Kotlin（@TsCallKotlin）：按 methodId（@RpcFun）调用
// 默认 30s 超时；opts: { timeoutMs, signal?: AbortSignal }；Promise 带 .cancel()
const version = await window.SimpleRpc.call('HostApi', 1, []);
const p = window.SimpleRpc.call('HostApi', 2, ['hi'], { timeoutMs: 5000 });
p.cancel(); // 发送 cancel + cefQueryCancel

// Kotlin → TS（@KotlinCallTs）：按 methodId 注册实现
window.SimpleRpc.register('WebApi', 2, async (name) => `hello ${name}`);
window.SimpleRpc.register('WebApi', 1, async () => {});
```

### 4. 校验（可选，注册/代理时也会校验）

```kotlin
SimpleRpc.requireSuspendMethods<HostApi>()
```

## 设计原则

- **接口即契约**：`@RpcFun` 标记 RPC 入口与方法 id；未标注方法可为常规逻辑
- **RPC 全 suspend**：跨 WebView 边界天然异步
- **先校验后接线**：proxy / 注册入口统一调用 `requireSuspendMethods`
- **契约与传输分离**：核心只依赖 `RpcTransport`；JCEF 适配在 `jcef` 包
- **CefMessageRouter 职责**：TS→Kotlin 走 `cefQuery`；Kotlin→TS 走 `executeJavaScript` 调用 `__simpleRpcOnHostMessage`

## 测试

```bash
./gradlew :SimpleRpc:test
```

覆盖：suspend 校验、双向 round-trip、远端错误传播、超时 / Job 取消、JS 桥脚本常量。

## 超时与取消

| 场景 | 行为 |
|------|------|
| 出站超时 | Kotlin 默认 30s → `RpcTimeoutException`，并向对端发 `cancel` |
| 调用方 `Job` 取消 | 清本地 pending，发 `cancel`；对端取消 inbound Job |
| 入站 `cancel` | 取消正在执行的 `scope.launch` 分发，不回 `res` |
| TS `call` 超时 / `.cancel()` / `AbortSignal` | 发 `cancel` + `cefQueryCancel` |
| CEF `onQueryCanceled` | 映射 queryId → requestId，注入 `cancel` 取消 Kotlin Job |
| 桥未注入 / 响应丢失 | 出站侧靠超时兜底，不再永久挂起 |

`CefMessageRouterTransport.handleQuery(queryId, …)` 在收到 `req` 时保持 query 打开，直到对应 `res`/`cancel` 写出，使 `cefQueryCancel` 能传到 Kotlin。

## 序列化类型

反射层使用 `java.lang.reflect.Type`（`genericParameterTypes` / Continuation 上的返回类型），经 `serializer(type)` 反序列化，因此 `List<Foo>`、`Map<String, Bar>`、`Pair<..>` 等泛型集合可保留元素类型。

DTO 仍需 `@Serializable`（或可被 kotlinx-serialization 解析）。密封类等更复杂结构按 kotlinx-serialization 规则声明。

入站 JSON 解析失败会写 `System.err`；若能取出 `id`，会对本地 pending 调用失败，或回一条失败 `res`。

## 规划中

- TypeScript 类型生成
