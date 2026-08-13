# AGENTS.md — Vibe Fly

本文件供在本仓库工作的编码 Agent 使用。

## 项目是什么

**Vibe Fly** — JetBrains IDE 优先的 vibe coding 插件。口号： *Vibe coding on the fly*。

基于 [pi](https://github.com/earendil-works/pi) 引擎（`@earendil-works/pi-*`）。在 IDE 内提供聊天式编码、多会话标签、上下文注入、工具审批，以及
AI 生成 Commit Message。

主要文档：`README.md`；设计设想见 `设想.md`；设置设计见 `docs/setting.md`。

## 架构（不可破坏）

```text
IDE (Kotlin) ──JCEF MessageRouter──► WebView UI (React)
     │                                    │
     │ SimpleRpc stdio（控制面）          │ SimpleRpc WebSocket（业务面）
     ▼                                    ▼
              Node Agent (pi)
```

| 通道            | 传输                                                     | 职责                                    |
|-----------------|----------------------------------------------------------|-----------------------------------------|
| Host ↔ Agent    | SimpleRpc over **stdio**（Content-Length）               | 生命周期、健康检查、WebSocket 会话控制  |
| WebView ↔ Host  | SimpleRpc over **JCEF MessageRouter**                    | IDE 能力：上下文、设置、打开文件 / Diff |
| WebView ↔ Agent | SimpleRpc over **WebSocket**（`127.0.0.1` + 一次性票据） | 业务 RPC 与流式事件                     |

### 硬性约束

1. **Agent 的 `stdout` 仅承载协议帧。** 日志一律写 **stderr**（winston）。Agent 内禁止向 stdout 打 `console.log`；`main.ts`
   会把 console 重定向到 stderr，防止第三方污染协议流。
2. **服务名约定为 `Caller2Callee`**（如 `Ui2Host`、`Host2Ui`、`Ui2Agent`、`Agent2Ui`、`Host2Agent`）。
3. **UI ↔ Agent 契约仅 TypeScript**，位于 `packages/vibefly-uiagent-shared`。 **不要**为这些接口再写 Kotlin 镜像。
4. **UI ↔ Host 契约** 在 `packages/vibefly-jcef`（`Ui2Host` / `Host2Ui`）；生成 TS：
   `./gradlew :vibefly-jcef:generateVibeflyUiRpc`。
5. JSON RPC 载荷优先传文件路径 / 范围，避免大量二进制 Base64。
6. 不要改上游 `pi` 包源码。通过 npm 依赖、hooks/extensions 或本仓 `vibefly-*` 适配层集成。若必须 patch，用包管理器 patch /
   独立 patch 目录，并注明原因。

## 仓库地图

| 路径                               | 技术栈                    | 职责                                                |
|------------------------------------|---------------------------|-----------------------------------------------------|
| `plugin/`                          | Kotlin、IntelliJ Platform | Tool Window、Actions、设置、VCS、Agent 进程管理     |
| `packages/vibefly-jcef/`           | Kotlin                    | JCEF 面板、`http://vibefly/` Scheme、Host↔UI RPC    |
| `packages/vibefly-agent/`          | Node/TS                   | pi 运行时 + stdio / WS 桥                           |
| `packages/vibefly-ui/`             | React/Vite/TS             | WebView UI（assistant-ui、Streamdown、Tailwind v4） |
| `packages/vibefly-uiagent-shared/` | TS                        | UI↔Agent 共享 RPC 契约                              |
| `packages/vibefly-simplerpc/`      | Kotlin + TS/Node          | SimpleRpc 传输与代码生成                            |
| `docs/`                            | Markdown                  | 设计笔记（如设置）                                  |
| `.run/`                            | IDEA Run Config           | 沙箱、UI Dev、附加调试器                            |

Kotlin 包根：`com.github.sandogeek.jetbrainsvibefly`。

自有包以 `vibefly-` 为前缀（npm：`@vibefly/*`，SimpleRpc：`@sandogeek/simple-rpc*`）。

### RPC 契约编写（uiagent-shared）

- 在 `contracts.ts` 中用抽象类 + `@rpcService()` / `@rpcId(n)` 定义服务。
- 方法需有可丢弃的实现体（TS 装饰器限制）；类保持 `abstract`。
- 改完后执行：`pnpm --filter @vibefly/uiagent-shared run generate`（CI / typecheck 用 `generate:check`）。
- 可选线名：`@rpcService("WireName")`。
- 控制参数用 `rpcOptions(...)`；生成器会从 wire 签名中剥离。

## 日志

| 组件  | 库                           | 输出           | 级别覆盖                                               |
|-------|------------------------------|----------------|--------------------------------------------------------|
| Agent | winston                      | **仅 stderr**  | `VIBEFLY_LOG_LEVEL`                                    |
| UI    | loglevel → Host `logFromWeb` | console + host | `localStorage.vibefly.log.level` / `VIBEFLY_LOG_LEVEL` |

## 代码约定

- 跟随当前文件 / 包的既有风格；不要整仓重排格式。
- TypeScript 包使用 `"type": "module"` 与现代 TS（约 5.8）。
- UI：React 19、Tailwind v4（`@tailwindcss/vite`）、`lib/utils.ts` 的 `cn()`、Lucide、assistant-ui 聊天原语。不要改成 singlefile
  打包（JCEF 需要代码分割）。
- Kotlin：JVM 21、EDT 辅助在 `util/Edt.kt`。
- i18n：插件文案在 `plugin/src/main/resources/messages/`；UI 在 `packages/vibefly-ui/src/i18n/`。
- 测试：agent/ui 的 `*.test.ts` 与源码同目录；插件测试在 `plugin/src/test/kotlin`。
- 不要提交密钥、API Key，以及生成物 `dist/`、`resources/web/`。
- 优先小而聚焦的 diff；不要顺手做无关重构。

## 收尾前检查清单

1. 改动的 TS 包：`pnpm --filter <pkg> run typecheck`（行为变更再跑 `test`）。
2. 契约变更：重新 generate，并保证 `generate:check` 通过。
3. Host↔UI RPC：用上面的 Gradle 任务重新生成。
4. Kotlin / 插件：在可行时跑 `./gradlew :plugin:test` 或针对性编译。

## 不要做的事
- 当前仍处于 beta 版本，不要考虑兼容性以及数据迁移。
- 不要把 `设想.md` 或 `docs/*.md` 当成运行时真相而不对照代码。
- 不要在 SimpleRpc 之外再加第二套 RPC 栈。
- 不要把 UI↔Agent 契约写进 Kotlin。
- 不要 force-push、改 git config，或在用户未要求时提交。
- 不要在文档未写明时自创 Marketplace 发布流程（除 `buildPlugin` 外）。
- 文档与代码间的对齐默认只改中文文档，只有明确需要修改英文文档的情况才同步英文文档。
