# @vibefly/agent

中文 | [English](./README.en.md)

Vibe Fly Node agent：对接 [pi](https://github.com/earendil-works/pi)（`@earendil-works/pi-coding-agent`），经 SimpleRpc stdio 与 JVM 插件通信。

## 职责

服务名约定：`Caller2Callee`（调用方 → 被调方）。

| 方向         | 协议                              | 说明                                |
|--------------|-----------------------------------|-------------------------------------|
| Host → Agent | SimpleRpc `Host2Agent`（stdio）   | `openWebSocketSession` / `shutdown` |
| UI → Agent   | SimpleRpc `Ui2Agent`（WebSocket） | `ping` / chat session APIs          |
| Agent → UI   | SimpleRpc `Agent2Ui`（WebSocket） | `onChatEvents` / permission / input |
| Agent 内部   | pi SDK                            | `createAgentSession` + 会话事件     |

约定（见仓库 `设想.md`）：

- `stdout` 仅承载 SimpleRpc Content-Length 帧
- 日志一律写 `stderr`（winston，禁止污染 stdout）
- 由插件启动并管理 Node.js 子进程

## 日志

使用 [winston](https://github.com/winstonjs/winston)，入口 `src/log.ts`。

| 项          | 说明                                                                                                                             |
|-------------|----------------------------------------------------------------------------------------------------------------------------------|
| 默认级别    | `info`                                                                                                                           |
| 覆盖        | 环境变量 `VIBEFLY_LOG_LEVEL`（`error` / `warn` / `info` / `http` / `verbose` / `debug` / `silly`；非法值回退 `info`）            |
| 输出        | **仅 stderr**，人类可读：`[vibefly-agent] <timestamp> INFO message …`                                                            |
| stdout      | 禁止写日志；`stdoutIsolation.ts` 将 `console.log` / `info` / `debug` 等 stdout 方法统一重定向到 stderr，防止第三方污染 SimpleRpc |
| commit dump | 模型/预算摘要为 `info`；systemPrompt / messages **全文** 仅在 `debug`（及更低）输出                                              |

```bash
VIBEFLY_LOG_LEVEL=debug pnpm run start
```

## 目录

```
packages/vibefly-agent/
  package.json
  tsconfig.json
  src/
    main.ts         # 入口：stdio peer
    log.ts          # winston logger（stderr-only）
```

## 开发

需要 Node.js ≥ 22 与 pnpm ≥ 9。

```bash
# 仓库根目录
pnpm install
pnpm run build:simplerpc
pnpm run build:shared

pnpm --filter @vibefly/agent run typecheck
pnpm --filter @vibefly/agent run build
pnpm --filter @vibefly/agent run start   # 前台 stdio 模式，供插件子进程或手工联调
```

### 手工联调

插件侧用 `ProcessBuilder` 启动，例如：

```text
node --import tsx /path/to/packages/vibefly-agent/src/main.ts
# 或
node /path/to/packages/vibefly-agent/dist/main.js
```

stdin/stdout 走 Content-Length SimpleRpc 控制面（`Host2Agent`）；业务 RPC 走 WebSocket（`Ui2Agent` / `Agent2Ui`）。

### 调试

#### IntelliJ / VS Code（Node.js 调试器）

使用 Node.js 调试器或 VS Code 的 Node.js launch/attach 配置调试 `src/main.ts`。

#### VS Code / 浏览器（attach 到插件拉起的 agent）

```bash
./gradlew :plugin:runIde -Pvibefly.debug=true
# 或 -Pvibefly.agent.inspect=6499
```

- IntelliJ IDEA：`.run/Attach Node Agent.run.xml` → **Attach Node Agent**（固定端口 `6499`）
- VS Code：`.vscode/launch.json` → **Attach vibefly-agent**（固定端口 `6499`）
- 浏览器：使用 Node.js Inspector 打开日志中的 `ws://...` 地址

## 依赖

- `@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai`：引擎
- `@sandogeek/simple-rpc-node`：stdio Content-Length + peer（本仓 `packages/vibefly-simplerpc`）
- `winston`：stderr 日志

定制与桥接只放在本包，不修改上游 pi 包路径。
