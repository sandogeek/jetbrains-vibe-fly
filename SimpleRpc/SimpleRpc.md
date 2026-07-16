# SimpleRpc

JCEF WebView（TypeScript）与 Kotlin/JVM 之间的双向 RPC 桥。用于 IntelliJ 插件内：界面跑在 JCEF，业务在 Kotlin，双方通过接口约定互相调用。

> 与 Node 侧 ClineSdk 的通讯走 gRPC；**界面 ↔ Kotlin** 走本模块。

## 目标

- 用 Kotlin `interface` 描述 RPC 契约，两端类型对齐
- 调用语义统一为 **异步**：接口方法必须是 `suspend`
- 运行时校验契约，避免非 suspend / 漏注解的接口进入注册或代理

## 方向

| 注解 | 实现所在 | 调用方 | 含义 |
|------|----------|--------|------|
| `@TsCallKotlin` | Kotlin/JVM | TypeScript | WebView 调宿主能力 |
| `@KotlinCallTs` | TypeScript | Kotlin | 宿主调 WebView 逻辑 |

可选参数 `value`：线上 service 名；默认取接口 simple name。

## 契约规则

1. 目标类型必须是 **interface**
2. 必须标注 `@TsCallKotlin` 或 `@KotlinCallTs`
3. **所有**业务方法必须是 `suspend`（JVM 上体现为末参为 `Continuation`）
4. 忽略 `equals` / `hashCode` / `toString` 以及 synthetic、bridge、static 方法

不满足时 `SimpleRpc.requireSuspendMethods` 抛出 `IllegalArgumentException`。

## 模块结构

```
SimpleRpc/
├── SimpleRpc.md
├── build.gradle.kts
└── src/
    ├── main/kotlin/com/github/sandogeek/simplerpc/
    │   ├── SimpleRpc.kt                 # 入口与校验 API
    │   ├── annotation/
    │   │   ├── KotlinCallTs.kt
    │   │   └── TsCallKotlin.kt
    │   └── internal/
    │       └── RpcSuspendRequirement.kt # suspend 反射检查
    └── test/kotlin/com/github/sandogeek/simplerpc/
        └── RpcSuspendRequirementTest.kt
```

依赖：`kotlin-stdlib`、`kotlinx-coroutines-core`。JVM 21。

## 用法（当前已实现）

定义接口：

```kotlin
@TsCallKotlin
interface HostApi {
    suspend fun getAppVersion(): String
    suspend fun logFromWeb(message: String)
}

@KotlinCallTs
interface WebApi {
    suspend fun notifyReady()
}
```

注册实现或创建代理**之前**校验：

```kotlin
SimpleRpc.requireSuspendMethods(HostApi::class.java)
// 或
SimpleRpc.requireSuspendMethods<HostApi>()
```

## 校验实现要点

`RpcSuspendRequirement`（`internal`）：

- 反射 `declaredMethods`
- 过滤非 RPC 候选方法
- 以「最后一个参数是否为 `Continuation`」判定 `suspend`
- 失败信息列出非 suspend 方法名

## 规划中（未实现）

- JCEF / JS bridge 传输层（request / response / error）
- Kotlin 侧：为 `@KotlinCallTs` 生成或动态创建 **proxy**
- Kotlin 侧：为 `@TsCallKotlin` **注册实现**并分发来自 TS 的调用
- TypeScript 侧：对等类型生成或手写 client / handler
- 序列化约定（参数、返回值、异常）
- 超时、取消（与 `Job` / `Continuation` 对齐）、并发与线程模型

## 测试

```bash
./gradlew :SimpleRpc:test
```

覆盖：合法 suspend 接口通过、含非 suspend 方法失败、缺少注解失败。

## 设计原则

- **接口即契约**：注解只标记方向与服务名，方法签名即 RPC API
- **全 suspend**：跨 WebView 边界天然异步，避免混用阻塞 API
- **先校验后接线**：proxy / 注册入口统一调用 `requireSuspendMethods`
- **契约与实现分离**：生产模块只提供注解与校验，业务 API 由宿主插件定义
