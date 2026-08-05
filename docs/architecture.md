# 架构

口号： *Vibe coding on the fly*。基于 [pi](https://github.com/earendil-works/pi) 引擎的 JetBrains IDE 优先 vibe coding 插件。

## 总览

```text
┌──────────────── IDE (Kotlin) ────────────────┐
│  Tool Window / Actions / Settings / VCS      │
│         │ JCEF MessageRouter (SimpleRpc)     │
│         ▼                                    │
│  WebView UI  ──WebSocket + 票据──► Node Agent │
│  (React + assistant-ui)                  (pi) │
│         ▲                              │     │
│         └──── stdio SimpleRpc 控制面 ──┘     │
└──────────────────────────────────────────────┘
```

| 层        | 技术                      | 职责                                            |
|-----------|---------------------------|-------------------------------------------------|
| **Host**  | Kotlin、IntelliJ Platform | 生命周期、IDE 能力、Agent 进程、设置持久化、VCS |
| **UI**    | React / Vite / JCEF       | 聊天、设置页、主题、上下文展示                  |
| **Agent** | Node.js + pi              | 会话、工具、模型、流式事件、Providers           |

## 三通道（均为 SimpleRpc）

| 通道            | 传输                                  | 服务名示例                  | 职责                                                           |
|-----------------|---------------------------------------|-----------------------------|----------------------------------------------------------------|
| Host ↔ Agent    | stdio（Content-Length）               | `Host2Agent` / `Agent2Host` | 控制面：开 WS 会话、shutdown、Commit Message、Providers / 登录 |
| WebView ↔ Host  | JCEF MessageRouter                    | `Ui2Host` / `Host2Ui`       | 宿主面：设置、上下文、打开文件 / Diff、主题、日志              |
| WebView ↔ Agent | WebSocket（`127.0.0.1` + 一次性票据） | `Ui2Agent` / `Agent2Ui`     | 业务面：聊天、工具审批、流式事件                               |

硬性约定：

1. Agent **`stdout` 仅承载协议帧**；日志一律 **stderr**（winston）。
2. 服务名 **`Caller2Callee`**。
3. **UI ↔ Agent 契约仅 TypeScript**（`packages/vibefly-uiagent-shared`），不为这些接口写 Kotlin 镜像。
4. **UI ↔ Host 契约** 在 `packages/vibefly-jcef`，生成 TS：`./gradlew :vibefly-jcef:generateVibeflyUiRpc`。
5. JSON 载荷优先传路径 / 范围，避免大块二进制 Base64。
6. 不改上游 pi 源码；定制放在 `vibefly-*` 适配层或 hooks/extensions。

详见 [rpc.md](./rpc.md)。

## 仓库地图

| 路径                               | 技术栈        | 职责                                                               |
|------------------------------------|---------------|--------------------------------------------------------------------|
| `plugin/`                          | Kotlin        | Tool Window、Actions、设置 State、VCS、Agent 进程管理              |
| `packages/vibefly-jcef/`           | Kotlin        | JCEF 面板、`http://vibefly/` Scheme、Host↔UI / Host↔Agent 控制 RPC |
| `packages/vibefly-agent/`          | Node/TS       | pi 运行时 + stdio / WS 桥、会话与调度                              |
| `packages/vibefly-ui/`             | React/Vite/TS | WebView UI                                                         |
| `packages/vibefly-uiagent-shared/` | TS            | UI↔Agent 共享契约                                                  |
| `packages/vibefly-simplerpc/`      | Kotlin + TS   | SimpleRpc 传输与代码生成                                           |
| `docs/`                            | Markdown      | 本目录                                                             |

Kotlin 包根：`com.github.sandogeek.jetbrainsvibefly`。  
自有包前缀：`vibefly-`（npm：`@vibefly/*`，SimpleRpc：`@sandogeek/simple-rpc*`）。

## 关键子系统（路径速查）

| 子系统         | 主要入口                                                                                                                |
|----------------|-------------------------------------------------------------------------------------------------------------------------|
| Agent 生命周期 | `plugin/.../agent/VibeflyAgentService.kt`、`VibeflyAgentProcess.kt`、`VibeflyAgentPaths.kt`、`VibeflyAgentDirectory.kt` |
| 控制面 RPC     | `vibefly-jcef/.../rpc/Host2Agent.kt`、`Agent2Host.kt`；Agent `src/generated/controlRpc.ts`、`main.ts`                   |
| 宿主面 RPC     | `vibefly-jcef/.../rpc/Ui2Host.kt`、`Host2Ui.kt`、`Ui2HostImpl.kt`；UI `src/generated/rpc.ts`、`src/rpc/client.ts`       |
| 业务面 RPC     | `vibefly-uiagent-shared/src/contracts.ts`；UI `src/rpc/agent.ts`；Agent `src/ws.ts`                                     |
| JCEF           | `VibeflyBrowserPanel.kt`、`VibeflyScheme.kt`、`ClasspathResourceHandler.kt`、`VibeflyUiDev.kt`                          |
| 设置（现状）   | `plugin/.../settings/*`；UI `packages/vibefly-ui/src/settings/*`                                                        |
| 聊天工作区     | `plugin/.../chat/ChatWorkspaceState.kt`、`ChatContextDeliveryService.kt`                                                |
| 会话 / 调度    | Agent `chatSessionRegistry.ts`、`chatScheduler.ts`；UI `src/chat/*`                                                     |
| Commit Message | `plugin/.../commit/*`；Agent `commitMessage.ts`                                                                         |

## 数据与目录

| 项             | 说明                                                                  |
|----------------|-----------------------------------------------------------------------|
| Agent 工作目录 | `~/.vibefly/<productCode 小写>/agent`（见 `VibeflyAgentDirectory`）   |
| Node 解析      | `-Dvibefly.node` → 常见路径 → `PATH`（`VibeflyAgentPaths`）           |
| Agent 入口     | `-Dvibefly.agent.entry` → 打包 `agent/dist/main.js` → monorepo 源码   |
| Providers 文件 | Agent 侧 `models.json` / `auth.json`（经控制面读写）                  |
| UI 生产资源    | `packages/vibefly-jcef/src/main/resources/web`（gitignore，构建生成） |

## 会话与调度（摘要）

- 每 Project 一个 Node coding agent（`VibeflyAgentService`，`Service.Level.PROJECT`）。
- UI 多标签会话（上限约 8），工作区状态在 `ChatWorkspaceState`（PROJECT 级）。
- Agent 内 `SerialTurnScheduler`：同 project **串行** turn（FIFO），避免并发改代码。
- 编辑器 / 拖拽上下文经 Host 缓冲，页面绑定后再投递到活跃会话。

详见 [agent.md](./agent.md)。

## 心智模型（四条）

1. **插件**做 IDE 集成并拉起 **Node agent**（按 project；设置相关见 [setting.md](./setting.md)）。
2. **控制面（stdio）** 只负责 WS 会话开关、shutdown、以及部分 Host 代发能力（Commit / Providers）。
3. **业务面（WS）** 承载聊天与流式事件；契约来自 **uiagent-shared**。
4. **宿主面（JCEF）** 只暴露 IDE 能力，避免 Agent 经 WS 拿全套 IDE API。
