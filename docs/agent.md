# Node Agent

Agent 是插件拉起的 **Node.js 子进程**，内嵌 [pi](https://github.com/earendil-works/pi) 编码会话引擎。包：
`packages/vibefly-agent`（`@vibefly/agent`）。

## 职责边界

| 面     | 协议                         | 做什么                                                               |
|--------|------------------------------|----------------------------------------------------------------------|
| 控制面 | SimpleRpc over **stdio**     | 开/关 WebSocket 会话、shutdown、Commit Message、Providers 快照与登录 |
| 业务面 | SimpleRpc over **WebSocket** | 聊天 turn、工具审批、流式事件                                        |
| 内部   | pi SDK                       | `createAgentSession`、模型、工具、扩展                               |

**不做**：直接操作 IDE UI、读全量 IDE API（宿主能力走 JCEF 的 `Ui2Host`）。

## 进程生命周期

### 现状

- `VibeflyAgentService`：`@Service(Service.Level.PROJECT)`， **每个 Project 一个** coding agent。
- `VibeflyAgentProcess`：`ProcessBuilder` 拉起 Node；关闭时 `control.shutdown()`（短超时），再销毁进程。
- 路径解析：`VibeflyAgentPaths`（Node 可执行文件、入口脚本）。
- Agent 数据目录：`VibeflyAgentDirectory` → `~/.vibefly/<productCode 小写>/agent`。

### 规划（尚未当作已实现）

`docs/setting.md` 中描述过 **独立 settings agent**（IDE 启动后常驻，不依赖 `withControlForSettings`）。当前实现仍是：设置相关
Providers 操作 **借用某个 project agent**（`withControlForSettings`）。详见 [setting.md](./setting.md)。

## 入口与 I/O

- 入口：`src/main.ts`（stdio peer + 控制面服务注册）。
- **stdout**：仅 SimpleRpc Content-Length 帧。
- **stderr**：winston 日志；`console.*` 在入口重定向到 stderr，防止第三方污染协议流。
- 业务：`src/ws.ts` 监听本机 WS，校验一次性票据后挂 `Ui2Agent` / 推 `Agent2Ui`。

```bash
# 前台手工跑（联调）
pnpm --filter @vibefly/agent run start
# 或
node --import tsx packages/vibefly-agent/src/main.ts
```

## 会话与调度

| 模块                                     | 职责                                                                    |
|------------------------------------------|-------------------------------------------------------------------------|
| `chatSessionRegistry.ts`                 | 每会话 pi `createAgentSession`、工具审批、写路径约束等                  |
| `chatScheduler.ts`                       | `SerialTurnScheduler`：同 project **单活跃 turn**，按 session FIFO 排队 |
| `commitMessage.ts`                       | 控制面触发的 Commit Message 生成                                        |
| `providerConfig.ts` / `providerLogin.ts` | models/auth 与登录流                                                    |

设计意图：同项目多标签可开多个会话，但 **串行执行 turn**，降低并发改文件冲突。

pi `AgentSessionEvent` → `ChatEvent` → UI → assistant-ui 的完整映射见 [chat-messages.md](./chat-messages.md)。

## 与 Host 的控制流（概念）

```text
UI 需要连 Agent
  → Ui2Host.getAgentConnection（或等价）
  → Host: VibeflyAgentService 确保进程存活
  → Host2Agent.openWebSocketSession
  → Agent 绑定 127.0.0.1 端口 + 票据
  → Host 把 endpoint 回给 UI
  → UI WebSocket 连接，业务 RPC 开始
```

关闭：Host `shutdown` / 进程退出 → 未完成请求失败；UI 侧应重连或提示。

## 调试

```bash
./gradlew :plugin:runIde -Pvibefly.debug=true
# 或 -Pvibefly.agent.inspect=6499
```

- IntelliJ： **Attach Node Agent**（`6499`）
- VS Code： **Attach vibefly-agent**
- 日志级别：`VIBEFLY_LOG_LEVEL=debug`（仅 stderr）

## 依赖与定制

- 引擎：`@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai` 等
- RPC：`@sandogeek/simple-rpc-node`
- 日志：`winston`

**不要**修改 `node_modules` 里的上游 pi 源码。必须 patch 时用包管理器 patch / 独立 patch 目录，并注明原因。本仓适配只放在
`vibefly-agent` 与其它 `vibefly-*` 包。

## 相关文档

- 包 README：[packages/vibefly-agent/README.md](../packages/vibefly-agent/README.md)
- 通道细节：[rpc.md](./rpc.md)
- 架构总览：[architecture.md](./architecture.md)
