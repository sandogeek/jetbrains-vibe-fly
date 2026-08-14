# SimpleRpc 三通道

所有跨进程 / 跨 WebView 通信统一走 **SimpleRpc**（`packages/vibefly-simplerpc`），不另起第二套 RPC 栈。

English: [rpc.en.md](./rpc.en.md)

服务名约定： **`Caller2Callee`**（如 `Ui2Host`、`Host2Ui`、`Ui2Agent`、`Agent2Ui`、`Host2Agent`）。

## 通道对照

```text
  WebView UI                    Host (Kotlin)                 Node Agent
  ─────────                     ─────────────                 ──────────
       │  Ui2Host / Host2Ui           │                            │
       │◄──── JCEF MessageRouter ────►│                            │
       │                              │  Host2Agent / Agent2Host   │
       │                              │◄──── stdio (Content-Length)─►│
       │                                                              │
       │  Ui2Agent / Agent2Ui                                         │
       │◄──────── WebSocket 127.0.0.1 + 一次性票据 ──────────────────►│
```

| 通道         | 传输                 | 契约位置                                        | 生成物                                               |
|--------------|----------------------|-------------------------------------------------|------------------------------------------------------|
| UI ↔ Host    | JCEF MessageRouter   | Kotlin：`vibefly-jcef` 的 `Ui2Host` / `Host2Ui` | `packages/vibefly-ui/src/generated/rpc.ts`           |
| Host ↔ Agent | stdio Content-Length | Kotlin：`Host2Agent` / `Agent2Host`             | `packages/vibefly-agent/src/generated/controlRpc.ts` |
| UI ↔ Agent   | WebSocket            | **仅 TS**：`vibefly-uiagent-shared`             | `contracts.generated.ts`                             |

## 1. 宿主面：UI ↔ Host

**用途**：仅 IDE 能力（避免 Agent 经 WS 拿全套 IDE API）。

典型能力（以代码为准）：

- 设置读写（`getSettingsSnapshot` / `saveSettings` 等）
- 获取 Agent 连接信息（WS 地址 + 票据）
- 上下文、打开文件 / Diff、主题、日志（`logFromWeb`）
- 状态推送（`Host2Ui`）

**实现要点**：

- UI：`packages/vibefly-ui/src/rpc/client.ts`（`createCefSimpleRpc`）
- Host：`VibeflyBrowserPanel` 挂 `CefMessageRouter`；实现 `Ui2HostImpl` 等
- 每面板独占 `window.vibeflyCefQuery_<channel>`，channel 由启动 URL 传入，避免设置页与工具窗口抢占同一会话

生成：

```bash
./gradlew :vibefly-jcef:generateVibeflyUiRpc
```

## 2. 控制面：Host ↔ Agent

**用途**：生命周期与 Host 代发能力； **不**承载聊天流。

典型 RPC（以代码为准）：

| 方向         | 示例                                                                                                                 |
|--------------|----------------------------------------------------------------------------------------------------------------------|
| Host → Agent | `openWebSocketSession`、`shutdown`、`generateCommitMessage`、`getProvidersSnapshot(modelsJson, authJson)`、`applyProvidersPatch(request, modelsJson)`、`setProviderApiKey`、`mutateCustomProvider`、登录相关 |
| Agent → Host | 控制面回调（若有）                                                                                                   |

**stdio 约定**：

- JVM → Node：子进程 **stdin**
- Node → JVM：子进程 **stdout**
- 帧格式：UTF-8 JSON + **Content-Length** 头（不依赖换行分割）
- **stdout 禁止日志**；winston / `console` 一律 stderr（`main.ts` 会重定向 console）
- 进程异常退出或 stdio 关闭 → JVM 结束会话并使未完成请求失败（`onClosed`）
- 控制面请求超时较长（如 OAuth 登录，约 6 分钟量级，以代码为准）

实现：`StdioRpcTransport`（Kotlin）+ `@sandogeek/simple-rpc-node`。

## 3. 业务面：UI ↔ Agent

**用途**：聊天、工具、流式事件。流式消息形态与 assistant-ui 适配见 [chat-messages.md](./chat-messages.md)。

**连接流程（概念）**：

1. UI 经 `Ui2Host` 向 Host 要连接信息。
2. Host 经 `Host2Agent.openWebSocketSession` 让 Agent 在 `127.0.0.1` 开 WS，并下发 **一次性票据**。
3. UI 用票据连上 WS，之后走 `Ui2Agent` / `Agent2Ui`。

契约编写（`packages/vibefly-uiagent-shared`）：

- 在 `contracts.ts` 用抽象类 + `@rpcService()` / `@rpcId(n)` 定义服务。
- 方法需有可丢弃的实现体（TS 装饰器限制）；类保持 `abstract`。
- 改完后：`pnpm --filter @vibefly/uiagent-shared run generate`
- CI / typecheck：`generate:check`
- 可选线名：`@rpcService("WireName")`
- 控制参数用 `rpcOptions(...)`；生成器会从 wire 签名中剥离

**禁止**：为 UI↔Agent 接口再写 Kotlin 镜像类型。

## 载荷原则

- 大文件优先传 **路径、范围、校验信息**，避免 Base64 塞进 JSON。
- 流式事件走业务面推送，不阻塞控制面。

## 改契约时的检查

1. 改 `contracts.ts` → generate + typecheck（ui + agent + shared）。
2. 改 `Ui2Host` / `Host2Ui` → `generateVibeflyUiRpc` + 编译插件与 UI。
3. 改 `Host2Agent` / `Agent2Host` → 控制面 codegen + agent typecheck。
4. 确认没有第二套 ad-hoc 消息协议。

更细的 SimpleRpc 语义见 [packages/vibefly-simplerpc/SimpleRpc.md](../packages/vibefly-simplerpc/SimpleRpc.md)。
