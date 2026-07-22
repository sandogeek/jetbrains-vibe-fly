# @vibefly/agent

Vibe Fly Bun agent：对接 [Oh My Pi](https://github.com/can1357/oh-my-pi)（`@oh-my-pi/pi-coding-agent`），经 SimpleRpc stdio 与 JVM 插件通信。

## 职责

服务名约定：`Caller2Callee`（调用方 → 被调方）。

| 方向 | 协议 | 说明 |
| --- | --- | --- |
| Host → Agent | SimpleRpc `Host2Agent`（stdio） | `openWebSocketSession` / `shutdown` |
| UI → Agent | SimpleRpc `Ui2Agent`（WebSocket） | `ping` / `startTask` |
| Agent → UI | SimpleRpc `Agent2Ui`（WebSocket） | `onAgentEvent` |
| Agent 内部 | Oh My Pi SDK | `createAgentSession` + 会话事件 |

约定（见仓库 `设想.md`）：

- `stdout` 仅承载 SimpleRpc Content-Length 帧
- 日志一律写 `stderr`
- 由插件启动并管理 Bun 子进程

## 目录

```
packages/vibefly-agent/
  package.json
  tsconfig.json
  src/
    main.ts         # 入口：stdio peer
    log.ts
```

## 开发

需要 [Bun](https://bun.sh) ≥ 1.1。

```bash
# 先构建 SimpleRpc Bun 传输（若尚未 build）
cd packages/vibefly-simplerpc/typeScript && bun install && bun run build
cd ../typeScript-bun && bun install && bun run build

cd packages/vibefly-agent
bun install
bun run typecheck
bun run build
bun run start          # 前台 stdio 模式，供插件子进程或手工联调
```

### 手工联调

插件侧用 `ProcessBuilder` 启动，例如：

```text
bun run /path/to/packages/vibefly-agent/src/main.ts
# 或
bun run /path/to/packages/vibefly-agent/dist/main.js
```

stdin/stdout 走 Content-Length SimpleRpc 控制面（`Host2Agent`）；业务 RPC 走 WebSocket（`Ui2Agent` / `Agent2Ui`）。

### 调试

#### IntelliJ（JetBrains Bun 插件）

安装 **Bun** 插件后，用 **Debug Bun Agent**（`.run/`）直接 launch `src/main.ts` 断点调试。

当前 Bun 插件只注册了 launch 配置类型（`BunRunConfiguration`），**没有**可用的 attach 类型；插件子进程 `--inspect` 请用下面 VS Code / 浏览器方式。

#### VS Code / 浏览器（attach 到插件拉起的 agent）

```bash
./gradlew :plugin:runIde -Pvibefly.debug=true
# 或 -Pvibefly.agent.inspect=6499
```

- VS Code：`.vscode/launch.json` → **Attach vibefly-agent**（粘贴 stderr 的 `ws://...`）
- 浏览器：打开日志中的 `https://debug.bun.sh/#...`

## 依赖

- `@oh-my-pi/pi-coding-agent` / `@oh-my-pi/pi-ai`：引擎
- `@sandogeek/simple-rpc-bun`：stdio Content-Length + peer（本仓 `packages/vibefly-simplerpc`）

定制与桥接只放在本包，不修改上游 Oh My Pi 包路径。
