# @vibefly/ui

English | [中文](./README.md)

Vibe Fly WebView frontend (Vite + React + assistant-ui + Streamdown + Tailwind CSS v4).

Build output is served to JCEF from the classpath via `vibefly-jcef`’s custom scheme (`http://vibefly/`). Vite’s default multi-chunk / code-splitting is kept; no singlefile inlining.

## Stack

- Vite
- React
- TypeScript
- [assistant-ui](https://www.assistant-ui.com/) (chat runtime and UI primitives)
- [Streamdown](https://streamdown.ai/) (streaming Markdown and code highlighting)
- [Lucide React](https://lucide.dev/) (icons)
- [Tailwind CSS v4](https://tailwindcss.com/) (`@tailwindcss/vite`)

## Layout

```
packages/vibefly-ui/
  index.html
  vite.config.ts
  src/
    index.tsx
    App.tsx
    styles.css             # entry: tailwind + styles/*
    styles/                # tokens, base, session, messages, composer, utilities
    lib/utils.ts           # cn() helper (clsx + tailwind-merge)
    components/ui/         # React primitives (Button / Dialog / TextField / …)
    rpc/client.ts          # createCefSimpleRpc + Ui2Host proxy
    generated/rpc.ts       # from Ui2Host/Host2Ui (./gradlew :vibefly-jcef:generateVibeflyUiRpc)
```

## Logging

Uses [loglevel](https://github.com/pimterry/loglevel), entry `src/log.ts`. Defaults to `console.*`, forwarded via `bindConsoleToHost` as `Ui2Host.logFromWeb` (host side: `WebView: …`).

| Item | Notes |
| --- | --- |
| Default level | `info` |
| Override | 1) `localStorage.vibefly.log.level` 2) `import.meta.env.VIBEFLY_LOG_LEVEL` 3) `info` |
| Prefix | `[vibefly-ui]` / `[vibefly-ui:<name>]` |

```js
localStorage.setItem("vibefly.log.level", "debug")
// takes effect after refresh
```

## SimpleRpc

Inside JCEF, panel-scoped `window.vibeflyCefQuery_<channel>` /
`vibeflyCefQueryCancel_<channel>` connect to `@sandogeek/simple-rpc`. The channel is
passed explicitly in the startup URL so settings and tool-window `Ui2Host` sessions
do not steal each other’s requests.
Service naming: `Caller2Callee` (caller → callee).

| Direction | Service | Notes |
| --- | --- | --- |
| UI → Host | `Ui2Host` | `getAppVersion` / `logFromWeb` / `getAgentConnection` |
| Host → UI | `Host2Ui` | `setStatus` |

Contracts live in `vibefly-jcef` (`Ui2Host` / `Host2Ui`). Generate with:

```bash
./gradlew :vibefly-jcef:generateVibeflyUiRpc
```

On the Kotlin side, `VibeflyBrowserPanel` attaches `CefMessageRouter` via `VibeflyUiRpc`.

## Development

Requires Node.js ≥ 22 and pnpm ≥ 9.

```bash
# repo root
pnpm install
pnpm --filter @vibefly/ui run dev        # http://127.0.0.1:5173 (Vite HMR)
pnpm --filter @vibefly/ui run build      # output → ../vibefly-jcef/src/main/resources/web
pnpm --filter @vibefly/ui run typecheck
pnpm --filter @vibefly/ui run preview
```

### Vite HMR in the IDE sandbox

The classpath scheme (`http://vibefly/`) cannot proxy WebSocket; for HMR, JCEF must load the Vite dev server directly.

Start the plugin sandbox (`runIde` waits for the Vite port; it does not start Vite itself):

- IDE (recommended): **Run Plugin + UI Dev** (Compound = **Run UI Dev** + **Run Plugin**)
- Or separately: **Run UI Dev** (`./gradlew runVibeflyUiDev`), then **Run Plugin** (`-Pvibefly.ui.dev=true`)
- CLI: `./gradlew runVibeflyUiDev`, then in another terminal `./gradlew :plugin:runIde -Pvibefly.ui.dev=true`
- Custom URL: `./gradlew :plugin:runIde -Pvibefly.ui.dev.url=http://127.0.0.1:5173/`

**Run UI Dev** runs Gradle task `runVibeflyUiDev` (foreground `pnpm run dev`; logs in IDE Run / Gradle console).
In ui.dev mode, `runIde` depends on `waitVibeflyUiDevServer` (default wait on `127.0.0.1:5173`, 60s timeout).

JVM properties:

| Property | Effect |
| --- | --- |
| `vibefly.ui.dev=true` | Load `http://127.0.0.1:5173/` |
| `vibefly.ui.dev.url=...` | Load the given Vite URL (wins) |

When unset, production path: `http://vibefly/index.html` (classpath static assets).

## JCEF integration

| Item | Notes |
| --- | --- |
| `base` | `./`, relative paths for `http://vibefly/` |
| Output dir | `packages/vibefly-jcef/src/main/resources/web` |
| Production URL | `http://vibefly/index.html` |
| Dev URL | `http://127.0.0.1:5173/` (Vite HMR) |
| Resource serving | `ClasspathResourceHandler` (classpath `web/**`) |

Gradle runs `buildVibeflyUi` (`pnpm run build`) before `:vibefly-jcef:processResources`. If `pnpm install` has not run, the task skips the build and logs. With `-Pvibefly.ui.dev=true` or `-Pvibefly.ui.dev.url=...`, `buildVibeflyUi` is not run (JCEF talks to Vite directly).

## Conventions

- Package names start with `vibefly-` (first-party code in this repo)
- Engine side is pi (`@earendil-works/pi-coding-agent`, etc.); this package is the JetBrains JCEF frontend and talks to host/agent over SimpleRpc
