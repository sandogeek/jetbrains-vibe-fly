# @vibefly/ui

Vibe Fly WebView 前端（Vite + SolidJS + SolidUI + Tailwind CSS v4）。

构建产物由 `vibefly-jcef` 的自定义 Scheme（`http://vibefly/`）从 classpath 提供给 JCEF，保留 Vite 默认多 chunk / 代码分割，无需 singlefile 内联。

## 技术栈

- Vite
- SolidJS
- TypeScript
- [SolidUI](https://www.solid-ui.com/)（基于 [Kobalte](https://kobalte.dev/) 的 shadcn 风格组件，源码位于 `src/components/ui/`）
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
    lib/utils.ts           # cn() helper (clsx + tailwind-merge)
    components/ui/         # SolidUI 组件（Button / Dialog / TextField / …）
    rpc/client.ts          # createCefSimpleRpc + Ui2Host proxy
    generated/rpc.ts       # from Ui2Host/Host2Ui (./gradlew :vibefly-jcef:generateVibeflyUiRpc)
```

## 日志

使用 [loglevel](https://github.com/pimterry/loglevel)，入口 `src/log.ts`。默认写 `console.*`，经 `bindConsoleToHost` 转发为 `Ui2Host.logFromWeb`（host 侧 `WebView: …`）。

| 项 | 说明 |
| --- | --- |
| 默认级别 | `info` |
| 覆盖 | 1) `localStorage.vibefly.log.level` 2) `import.meta.env.VIBEFLY_LOG_LEVEL` 3) `info` |
| 前缀 | `[vibefly-ui]` / `[vibefly-ui:<name>]` |

```js
localStorage.setItem("vibefly.log.level", "debug")
// 刷新页面后生效
```

## SimpleRpc

JCEF 内通过面板独占的 `window.vibeflyCefQuery_<channel>` /
`vibeflyCefQueryCancel_<channel>` 接入 `@sandogeek/simple-rpc`；channel 由启动 URL
显式传给页面，避免设置页和工具窗口的 `Ui2Host` 会话互相抢占请求。
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

需要 Node.js ≥ 22（包含 npm）。

```bash
cd packages/vibefly-ui
npm install
npm run dev        # http://127.0.0.1:5173 （Vite HMR）
npm run build      # 输出到 ../vibefly-jcef/src/main/resources/web
npm run typecheck
npm run preview
```

### 在 IDE 沙箱中接 Vite 热更

classpath scheme（`http://vibefly/`）无法代理 WebSocket，HMR 需让 JCEF 直接加载 Vite dev server。

启动插件沙箱（`runIde` 会等待 Vite 端口就绪，不自动启动）：

- IDE（推荐）：**Run Plugin + UI Dev**（Compound = **Run UI Dev** + **Run Plugin**）
- 或分别：**Run UI Dev**（`./gradlew runVibeflyUiDev`），再 **Run Plugin**（`-Pvibefly.ui.dev=true`）
- CLI：`./gradlew runVibeflyUiDev`，另开终端 `./gradlew :plugin:runIde -Pvibefly.ui.dev=true`
- 自定义 URL：`./gradlew :plugin:runIde -Pvibefly.ui.dev.url=http://127.0.0.1:5173/`

**Run UI Dev** 走 Gradle 任务 `runVibeflyUiDev`（前台 `npm run dev`，日志在 IDE Run / Gradle 控制台）。
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

Gradle 在 `:vibefly-jcef:processResources` 前会执行 `buildVibeflyUi`（`npm run build`）。若尚未 `npm install`，该任务会跳过构建并打日志。
使用 `-Pvibefly.ui.dev=true` 或 `-Pvibefly.ui.dev.url=...` 时不跑 `buildVibeflyUi`（JCEF 直连 Vite）。

## 约定

- 包名以 `vibefly-` 开头，为本仓库自有代码
- 引擎侧基于 pi（`@earendil-works/pi-coding-agent` 等）；本包为 JetBrains JCEF 自研前端，经 SimpleRpc 与主机/agent 通信
