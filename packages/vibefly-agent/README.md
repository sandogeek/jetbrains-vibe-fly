# @vibefly/agent

Vibe Fly Bun agent：对接 [Oh My Pi](https://github.com/can1357/oh-my-pi)（`@oh-my-pi/pi-coding-agent`），经 SimpleRpc stdio 与 JVM 插件通信。

## 职责

| 侧 | 协议 | 说明 |
| --- | --- | --- |
| JVM → Agent | SimpleRpc `AgentApi` | `configure` / `startTask` / `cancelTask` / `resolveApproval` / `shutdown` |
| Agent → JVM | SimpleRpc `AgentHostApi` | 状态、流式文本、工具进度、审批请求、任务完成/失败 |
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

stdin/stdout 走 Content-Length SimpleRpc；配置与任务由 `AgentApi` 下发。

### `configure` 要点

| 字段 | 说明 |
| --- | --- |
| `cwd` | 工作区根目录 |
| `providerId` / `modelId` | Oh My Pi 模型（如 `anthropic` / `claude-sonnet-4-5`） |
| `apiKey` | 可选；运行时注入 `AuthStorage.setRuntimeApiKey`（不落盘） |
| `baseUrl` | 预留；自定义 endpoint 可后续接 models.yml / registry override |
| `systemPrompt` | 可选系统提示 |

模型解析：`ModelRegistry.find(providerId, modelId)`，否则在 `getAll()` 中匹配。

### 工具审批

写文件类（`write` / `edit` / `ast_edit`）与命令类（`bash` / `eval` / `ssh` 等）通过 omp extension 的 `tool_call` 钩子拦截，经 `AgentHostApi.approvalRequested` 交给 IDE；只读类工具自动放行。

## 依赖

- `@oh-my-pi/pi-coding-agent` / `@oh-my-pi/pi-ai`：引擎
- `@sandogeek/simple-rpc-bun`：stdio Content-Length + peer（本仓 `packages/vibefly-simplerpc`）

定制与桥接只放在本包，不修改上游 Oh My Pi 包路径。
