# 开发指南

## 前置条件

- JDK **21+**
- Node.js **≥ 22**
- pnpm **≥ 9**（根目录 `package.json` 的 `packageManager`；推荐 `corepack enable`）
- 可访问 IntelliJ Platform 依赖（Gradle 拉取）

## 初始化

```bash
corepack enable   # 若尚未启用
pnpm install
pnpm run build:simplerpc
pnpm run build:shared
```

Gradle 在打包资源前会构建 UI / Agent；未 `pnpm install` 时相关任务可能跳过并打日志。

## 常用命令

### 根目录（pnpm）

```bash
pnpm run build:simplerpc   # @sandogeek/simple-rpc + simple-rpc-node
pnpm run build:shared      # @vibefly/uiagent-shared
pnpm run build:agent
pnpm run build:ui
pnpm run typecheck         # 全部包
pnpm run test              # 全部包
```

### 按包

```bash
pnpm --filter @vibefly/agent run typecheck|build|test|start
pnpm --filter @vibefly/ui run dev|build|typecheck|test
pnpm --filter @vibefly/uiagent-shared run generate|generate:check|typecheck|test
```

- Agent / UI 测试：`node --import tsx --test 'src/**/*.test.ts'`
- Shared：`generate:check` 确保 `contracts.generated.ts` 与契约同步

### Gradle / 插件

```bash
./gradlew :plugin:runIde              # IDE 沙箱
./gradlew :plugin:buildPlugin         # zip → plugin/build/distributions/
./gradlew :plugin:test
./gradlew :vibefly-jcef:generateVibeflyUiRpc
./gradlew runVibeflyUiDev             # 仅 Vite HMR
```

| 属性                                                    | 用途                                            |
|---------------------------------------------------------|-------------------------------------------------|
| `-Pvibefly.ui.dev=true`                                 | JCEF 加载 Vite（默认 `http://127.0.0.1:5173/`） |
| `-Pvibefly.ui.dev.url=...`                              | 自定义 UI 开发地址                              |
| `-Pvibefly.debug=true` / `-Pvibefly.agent.inspect=6499` | Agent Node inspector，端口 **6499**             |

## Run Configuration（`.run/`）

| 配置                                  | 用途                              |
|---------------------------------------|-----------------------------------|
| **Run Plugin**                        | 插件沙箱                          |
| **Run Plugin + UI Dev**               | 沙箱 + Vite HMR（改 UI 推荐）     |
| **Run UI Dev**                        | 仅 Vite                           |
| **Attach Node Agent**                 | 附加 Agent（`127.0.0.1:6499`）    |
| **Attach JCEF**                       | 附加沙箱 JCEF（`127.0.0.1:9222`） |
| **Run Tests** / **Run Verifications** | 测试与校验                        |

## UI 热更新

classpath scheme（`http://vibefly/`）**无法代理 WebSocket**，开发时让 JCEF 直连 Vite：

```bash
# 终端 1
./gradlew runVibeflyUiDev

# 终端 2
./gradlew :plugin:runIde -Pvibefly.ui.dev=true
```

或使用 **Run Plugin + UI Dev**。生产仍走 jar 内资源：`http://vibefly/index.html`。  
UI 构建输出：`packages/vibefly-jcef/src/main/resources/web`（gitignore）。

`ui.dev` 模式下 `runIde` 会 `waitVibeflyUiDevServer`（默认等 `127.0.0.1:5173`，超时约 60s）， **不**自动启动 Vite。

## Agent 调试

```bash
./gradlew :plugin:runIde -Pvibefly.debug=true
# 或 -Pvibefly.agent.inspect=6499
```

- IntelliJ： **Attach Node Agent**（端口 6499）
- VS Code：`.vscode/launch.json` → **Attach vibefly-agent**
- 浏览器：Node Inspector / 日志中的 `ws://…`

## 代码生成

| 契约                | 命令                                                  | 输出                                                 |
|---------------------|-------------------------------------------------------|------------------------------------------------------|
| Host ↔ UI           | `./gradlew :vibefly-jcef:generateVibeflyUiRpc`        | `packages/vibefly-ui/src/generated/rpc.ts`           |
| Host ↔ Agent 控制面 | Gradle `generateVibeflyAgentControlRpc`（打包链路内） | `packages/vibefly-agent/src/generated/controlRpc.ts` |
| UI ↔ Agent          | `pnpm --filter @vibefly/uiagent-shared run generate`  | `contracts.generated.ts`                             |

改 `contracts.ts` 后必须 re-generate，并保证 `generate:check` 通过。

## 日志

| 组件  | 库                           | 输出           | 级别覆盖                                               |
|-------|------------------------------|----------------|--------------------------------------------------------|
| Agent | winston                      | **仅 stderr**  | `VIBEFLY_LOG_LEVEL`                                    |
| UI    | loglevel → Host `logFromWeb` | console + host | `localStorage.vibefly.log.level` / `VIBEFLY_LOG_LEVEL` |

```bash
VIBEFLY_LOG_LEVEL=debug   # Agent
```

```js
localStorage.setItem("vibefly.log.level", "debug")  // UI，刷新后生效
```

## 约定

- 跟随当前文件 / 包风格；不做无关整仓重排。
- TS：`"type": "module"`、现代 TS（约 5.8）。
- UI：React 19、Tailwind v4、`cn()`、Lucide、assistant-ui； **不要**改成 singlefile 打包。
- Kotlin：JVM 21；EDT 辅助见 `util/Edt.kt`。
- i18n：插件 `plugin/src/main/resources/messages/`；UI `packages/vibefly-ui/src/i18n/`。
- 测试：agent/ui 的 `*.test.ts` 与源码同目录；插件测试 `plugin/src/test/kotlin`。
- 不提交密钥、`dist/`、`resources/web/`。
- **不要** force-push、改 git config，或在用户未要求时提交。

## 收尾检查清单

1. 改动的 TS 包：`pnpm --filter <pkg> run typecheck`（行为变更再 `test`）。
2. 契约变更：re-generate + `generate:check`。
3. Host↔UI RPC：Gradle 重新生成。
4. Kotlin：可行时 `./gradlew :plugin:test` 或针对性编译。
5. 动到 agent I/O：确认日志仍不写 stdout。
6. 可选全仓：`pnpm run typecheck` / `pnpm run test`。

## 改哪里

| 目标                    | 从这里开始                                                     |
|-------------------------|----------------------------------------------------------------|
| 聊天 / 工具 UX          | `packages/vibefly-ui/src/`                                     |
| Agent 会话、工具、pi 桥 | `packages/vibefly-agent/src/`                                  |
| UI↔Agent RPC            | `packages/vibefly-uiagent-shared/src/contracts.ts` → generate  |
| Host↔UI RPC             | `packages/vibefly-jcef` + 重新生成                             |
| Agent 进程              | `plugin/.../agent/`                                            |
| 设置（宿主）            | `plugin/.../settings/`；UI `packages/vibefly-ui/src/settings/` |
| Commit Message          | `plugin/.../commit/` + agent `commitMessage.ts`                |
| SimpleRpc 核心          | `packages/vibefly-simplerpc/`                                  |
