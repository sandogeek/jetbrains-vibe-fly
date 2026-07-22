# @vibefly/ui

Vibe Fly WebView 前端（Vite + SolidJS + Ark UI + Tailwind CSS v4）。

构建产物由 `vibefly-jcef` 的自定义 Scheme（`http://vibefly/`）从 classpath 提供给 JCEF，保留 Vite 默认多 chunk / 代码分割，无需 singlefile 内联。

## 技术栈

- Vite
- SolidJS
- TypeScript
- [Ark UI](https://ark-ui.com/)（`@ark-ui/solid`，无样式 headless 组件）
- [Tailwind CSS v4](https://tailwindcss.com/)（`@tailwindcss/vite`）

## 目录

```
packages/vibefly-ui/
  index.html
  vite.config.ts
  src/
    index.tsx
    App.tsx
    styles.css
    rpc/client.ts          # createCefSimpleRpc + Ui2Host proxy
    generated/rpc.ts       # from Ui2Host/Host2Ui (./gradlew :vibefly-jcef:generateVibeflyUiRpc)
```

## SimpleRpc

JCEF 内通过 `window.cefQuery` / `cefQueryCancel` 接入 `@sandogeek/simple-rpc`。
服务名约定：`Caller2Callee`（调用方 → 被调方）。

| 方向 | 服务 | 说明 |
| --- | --- | --- |
| UI → Host | `Ui2Host` | `getAppVersion` / `logFromWeb` / `getAgentConnection` |
| Host → UI | `Host2Ui` | `setStatus` |

契约定义在 `vibefly-jcef`（`Ui2Host` / `Host2Ui`），生成：

```bash
./gradlew :vibefly-jcef:generateVibeflyUiRpc
```

Kotlin 侧在 `VibeflyBrowserPanel` 经 `VibeflyUiRpc` 挂上 `CefMessageRouter`。

## 开发

需要 [Bun](https://bun.sh)。

```bash
cd packages/vibefly-ui
bun install
bun run dev        # http://127.0.0.1:5173 （Vite HMR）
bun run build      # 输出到 ../vibefly-jcef/src/main/resources/web
bun run typecheck
bun run preview
```

### 在 IDE 沙箱中接 Vite 热更

classpath scheme（`http://vibefly/`）无法代理 WebSocket，HMR 需让 JCEF 直接加载 Vite dev server。

启动插件沙箱（`runIde` 会等待 Vite 端口就绪，不自动启动）：

- IDE（推荐）：**Run Plugin + UI Dev**（Compound = **Run UI Dev** + **Run Plugin**）
- 或分别：**Run UI Dev**（`./gradlew runVibeflyUiDev`），再 **Run Plugin**（`-Pvibefly.ui.dev=true`）
- CLI：`./gradlew runVibeflyUiDev`，另开终端 `./gradlew :plugin:runIde -Pvibefly.ui.dev=true`
- 自定义 URL：`./gradlew :plugin:runIde -Pvibefly.ui.dev.url=http://127.0.0.1:5173/`

**Run UI Dev** 走 Gradle 任务 `runVibeflyUiDev`（前台 `bun run dev`，日志在 IDE Run / Gradle 控制台）。  
ui.dev 模式下 `runIde` 依赖 `waitVibeflyUiDevServer`（默认等 `127.0.0.1:5173`，超时 60s）。

对应 JVM 属性：

| 属性 | 作用 |
| --- | --- |
| `vibefly.ui.dev=true` | 加载 `http://127.0.0.1:5173/` |
| `vibefly.ui.dev.url=...` | 加载指定 Vite 地址（优先） |

未开启时仍走生产路径：`http://vibefly/index.html` （classpath 静态资源）。

## 与 JCEF 的衔接

| 项 | 说明 |
| --- | --- |
| `base` | `./`，相对路径，适配 `http://vibefly/` |
| 输出目录 | `packages/vibefly-jcef/src/main/resources/web` |
| 生产 URL | `http://vibefly/index.html` |
| 开发 URL | `http://127.0.0.1:5173/`（Vite HMR） |
| 资源服务 | `ClasspathResourceHandler`（classpath `web/**`） |

Gradle 在 `:vibefly-jcef:processResources` 前会执行 `buildVibeflyUi`（`bun run build`）。若尚未 `bun install`，该任务会跳过构建并打日志。  
使用 `-Pvibefly.ui.dev=true` 或 `-Pvibefly.ui.dev.url=...` 时不跑 `buildVibeflyUi`（JCEF 直连 Vite）。

## 约定

- 包名以 `vibefly-` 开头，为本仓库自有代码
- 引擎侧基于 Oh My Pi（`@oh-my-pi/pi-coding-agent` 等）；本包为 JetBrains JCEF 自研前端，经 SimpleRpc 与主机/agent 通信
