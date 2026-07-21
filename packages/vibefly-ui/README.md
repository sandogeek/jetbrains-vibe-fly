# @vibefly/ui

Vibe Fly WebView 前端（Vite + SolidJS + TypeScript）。

构建产物由 `vibefly-jcef` 的自定义 Scheme（`http://vibefly/`）从 classpath 提供给 JCEF，保留 Vite 默认多 chunk / 代码分割，无需 singlefile 内联。

## 技术栈

- Vite
- SolidJS
- TypeScript

## 目录

```
packages/vibefly-ui/
  index.html
  vite.config.ts
  src/
    index.tsx
    App.tsx
    styles.css
```

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

classpath scheme（`http://vibefly/`）无法代理 WebSocket，HMR 需让 JCEF 直接加载 Vite dev server：

1. 终端：`cd packages/vibefly-ui && bun run dev`
2. 启动插件沙箱（任选其一）：
   - `./gradlew :plugin:runIde -Pvibefly.ui.dev=true`
   - 或自定义：`./gradlew :plugin:runIde -Pvibefly.ui.dev.url=http://127.0.0.1:5173/`

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

## 约定

- 包名以 `vibefly-` 开头，为本仓库自有代码
- 后续可接入 fork 的 OpenCode UI：`packages/opencode/packages/ui`（`@opencode-ai/ui`）
