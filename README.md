# Vibe Fly

**Vibe coding on the fly** — JetBrains IDE 优先的 vibe coding 插件。

![Build](https://github.com/sandogeek/jetbrains-vibe-fly/workflows/Build/badge.svg)

基于 [pi](https://github.com/earendil-works/pi) 引擎，在 IDE 内提供聊天式编码助手：多会话对话、代码上下文注入、分级工具审批，以及 AI 生成 Commit Message。

## 功能

| 能力 | 说明 |
| --- | --- |
| **工具窗聊天** | `Vibe Fly` Tool Window（JCEF WebView），流式对话与工具调用 |
| **多会话标签** | 每标签独立 pi 会话；同项目串行调度，避免并发改代码 |
| **上下文注入** | Floating Toolbar「Add to Vibe Fly」、文件选择、拖拽项目文件 |
| **工具审批** | `read/grep/glob` 等自动执行；`bash/edit/write` 需确认 |
| **Commit Message** | VCS 提交区一键生成；可配置语言（跟随 IDE / 英文 / 简体中文） |
| **设置** | Providers、模型偏好、Commit Message；支持编辑器标签页打开 |

## 架构

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

| 通道 | 传输 | 职责 |
| --- | --- | --- |
| Host ↔ Agent | SimpleRpc over **stdio**（Content-Length） | 生命周期、健康检查、WebSocket 会话控制 |
| WebView ↔ Host | SimpleRpc over **JCEF MessageRouter** | IDE 能力：上下文、设置、打开文件 / Diff |
| WebView ↔ Agent | SimpleRpc over **WebSocket**（`127.0.0.1` + 一次性票据） | 业务 RPC 与流式事件 |

约定：Agent `stdout` **仅**承载协议帧，日志一律写 `stderr`。

## 仓库结构

| 路径 | 说明 |
| --- | --- |
| `plugin/` | IntelliJ 插件（Kotlin）：Tool Window、Actions、设置、Agent 进程管理 |
| `packages/vibefly-jcef/` | JCEF 面板、自定义 `http://vibefly/` Scheme、Host↔UI RPC |
| `packages/vibefly-agent/` | Node Agent：pi 运行时 + stdio / WebSocket 桥 |
| `packages/vibefly-ui/` | WebView 前端：Vite + React + assistant-ui + Streamdown + Tailwind CSS v4 |
| `packages/vibefly-uiagent-shared/` | UI ↔ Agent 共享 RPC 契约（TypeScript） |
| `packages/vibefly-simplerpc/` | SimpleRpc：Kotlin + TypeScript / Node.js 传输与代码生成 |

## 安装

### 从源码运行（开发）

前置：

- JDK 21+
- Node.js ≥ 22
- pnpm ≥ 9（推荐 `corepack enable`，仓库 `packageManager` 会锁定版本）
- 可访问的 IntelliJ Platform 依赖（Gradle 会拉取）

```bash
# 安装前端 / Agent 依赖（pnpm workspace）
corepack enable   # 若尚未启用
pnpm install
pnpm run build:simplerpc
pnpm run build:shared

# 启动 IDE 沙箱
./gradlew :plugin:runIde
```

Gradle 在打包资源前会构建 UI（`buildVibeflyUi`）与 Agent；未 `pnpm install` 时相关任务会跳过并打日志。

### 手动安装构建产物

1. 构建：`./gradlew :plugin:buildPlugin`
2. 在 IDE：`Settings/Preferences` → `Plugins` → `⚙️` → `Install Plugin from Disk…`
3. 选择 `plugin/build/distributions/` 下的 zip

### JetBrains Marketplace

尚未发布时请用上方手动方式。发布后可通过 Marketplace 搜索 **Vibe Fly** 安装。

## 开发

### 常用 Run Configuration（`.run/`）

| 配置 | 用途 |
| --- | --- |
| **Run Plugin** | 启动插件沙箱 |
| **Run Plugin + UI Dev** | 沙箱 + Vite HMR（推荐改 UI 时用） |
| **Run UI Dev** | 仅启动 Vite（`http://127.0.0.1:5173`） |
| **Attach Node Agent** | 附加到插件拉起的 Agent（`127.0.0.1:6499`） |
| **Attach JCEF** | 附加到沙箱 JCEF（`127.0.0.1:9222`） |
| **Run Tests** / **Run Verifications** | 测试与校验 |

### UI 热更新

classpath scheme（`http://vibefly/`）无法代理 WebSocket，开发时让 JCEF 直连 Vite：

```bash
# 终端 1
./gradlew runVibeflyUiDev

# 终端 2
./gradlew :plugin:runIde -Pvibefly.ui.dev=true
# 或自定义：-Pvibefly.ui.dev.url=http://127.0.0.1:5173/
```

生产路径仍为 `http://vibefly/index.html`（jar 内静态资源）。

### Agent 调试

```bash
./gradlew :plugin:runIde -Pvibefly.debug=true
# 或 -Pvibefly.agent.inspect=6499
```

- VS Code：`.vscode/launch.json` → **Attach vibefly-agent**，按固定端口 `6499` 附加
- IntelliJ IDEA：运行 **Attach Node Agent**，直接按固定端口 `6499` 附加，无需填写动态 Inspector URL
- 浏览器：使用 Node.js Inspector 或 VS Code Node.js 调试器附加到日志中的 `ws://…` 地址

### 日志

| 组件 | 方式 | 级别覆盖 |
| --- | --- | --- |
| Agent | winston → **stderr only** | `VIBEFLY_LOG_LEVEL` |
| UI | loglevel → Host `logFromWeb` | `localStorage.vibefly.log.level` / `VIBEFLY_LOG_LEVEL` |

### 文档

- [docs/](./docs/README.md) — 架构、开发、RPC、Agent、设置
- [packages/vibefly-agent](./packages/vibefly-agent/README.md)
- [packages/vibefly-ui](./packages/vibefly-ui/README.md)
- [packages/vibefly-uiagent-shared](./packages/vibefly-uiagent-shared/README.md) · [中文](./packages/vibefly-uiagent-shared/README.zh-CN.md)
- [packages/vibefly-simplerpc/SimpleRpc.md](./packages/vibefly-simplerpc/SimpleRpc.md)

### 约定

- 本仓自有包以 `vibefly-` 开头
- 上游 pi 以 npm 依赖接入；定制放在 `vibefly-*` 适配层，不修改上游包路径
- 若必须 patch 上游：优先包管理器 patch / 独立 patch 目录，并注明来源与原因

## 路线图（摘录）

- [x] JCEF WebView + SimpleRpc 三通道
- [x] Node.js Agent（pi）子进程管理
- [x] Commit Message 生成
- [x] 选区 / 文件上下文注入
- [ ] 多会话标签与 FIFO 调度
- [ ] 多主题色（默认跟随 IDE）
- [ ] 进程级沙箱

## 许可证与致谢

- 插件脚手架基于 [IntelliJ Platform Plugin Template](https://github.com/JetBrains/intellij-platform-plugin-template)
- 引擎：[pi](https://github.com/earendil-works/pi)

---

问题与建议请开 [GitHub Issues](https://github.com/sandogeek/jetbrains-vibe-fly/issues)。
