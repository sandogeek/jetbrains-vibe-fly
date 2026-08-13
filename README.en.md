# Vibe Fly

**Vibe coding on the fly** — a JetBrains IDE–first vibe coding plugin.

![Build](https://github.com/sandogeek/jetbrains-vibe-fly/workflows/Build/badge.svg)

中文版：[README.md](./README.md)

Built on the [pi](https://github.com/earendil-works/pi) engine. In-IDE chat coding assistant with multi-session tabs, code context injection, graded tool approval, and AI-generated commit messages.

## Features

| Capability | Description |
| --- | --- |
| **Tool window chat** | `Vibe Fly` Tool Window (JCEF WebView), streaming replies and tool calls |
| **Multi-session tabs** | One pi session per tab; same-project serial scheduling to avoid concurrent edits |
| **Context injection** | Floating Toolbar “Add to Vibe Fly”, file pickers, drag project files |
| **Tool approval** | Auto-run `read` / `grep` / `glob`; confirm `bash` / `edit` / `write` |
| **Commit Message** | One-click generate in the VCS commit area; language: follow IDE / English / Simplified Chinese |
| **Settings** | Providers, model prefs, Commit Message; openable as an editor tab |

## Architecture

```text
┌──────────────── IDE (Kotlin) ────────────────┐
│  Tool Window / Actions / Settings / VCS      │
│         │ JCEF MessageRouter (SimpleRpc)     │
│         ▼                                    │
│  WebView UI  ──WebSocket + ticket──► Node Agent │
│  (React + assistant-ui)                  (pi) │
│         ▲                              │     │
│         └──── stdio SimpleRpc control ─┘     │
└──────────────────────────────────────────────┘
```

| Channel | Transport | Role |
| --- | --- | --- |
| Host ↔ Agent | SimpleRpc over **stdio** (Content-Length) | Lifecycle, health, WebSocket session control |
| WebView ↔ Host | SimpleRpc over **JCEF MessageRouter** | IDE capabilities: context, settings, open file / Diff |
| WebView ↔ Agent | SimpleRpc over **WebSocket** (`127.0.0.1` + one-time ticket) | Business RPC and streaming events |

Rule: Agent `stdout` carries **protocol frames only**; all logs go to `stderr`.

## Repository layout

| Path | Description |
| --- | --- |
| `plugin/` | IntelliJ plugin (Kotlin): Tool Window, Actions, settings, Agent process management |
| `packages/vibefly-jcef/` | JCEF panel, custom `http://vibefly/` scheme, Host↔UI RPC |
| `packages/vibefly-agent/` | Node Agent: pi runtime + stdio / WebSocket bridge |
| `packages/vibefly-ui/` | WebView frontend: Vite + React + assistant-ui + Streamdown + Tailwind CSS v4 |
| `packages/vibefly-uiagent-shared/` | UI ↔ Agent shared RPC contracts (TypeScript) |
| `packages/vibefly-simplerpc/` | SimpleRpc: Kotlin + TypeScript / Node.js transport and codegen |

## Install

### Run from source (development)

Prerequisites:

- JDK 21+
- Node.js ≥ 22
- pnpm ≥ 9 (prefer `corepack enable`; repo `packageManager` pins the version)
- Reachable IntelliJ Platform dependencies (fetched by Gradle)

```bash
# Install frontend / Agent deps (pnpm workspace)
corepack enable   # if not already enabled
pnpm install
pnpm run build:simplerpc
pnpm run build:shared

# Start IDE sandbox
./gradlew :plugin:runIde
```

Gradle builds UI (`buildVibeflyUi`) and Agent before packaging resources; related tasks skip with a log line if `pnpm install` has not been run.

### Install a built artifact manually

1. Build: `./gradlew :plugin:buildPlugin`
2. In the IDE: `Settings/Preferences` → `Plugins` → `⚙️` → `Install Plugin from Disk…`
3. Pick the zip under `plugin/build/distributions/`

### JetBrains Marketplace

Until published, use the manual install above. After release, search **Vibe Fly** on Marketplace.

## Development

### Common Run Configurations (`.run/`)

| Config | Purpose |
| --- | --- |
| **Run Plugin** | Start plugin sandbox |
| **Run Plugin + UI Dev** | Sandbox + Vite HMR (recommended when editing UI) |
| **Run UI Dev** | Vite only (`http://127.0.0.1:5173`) |
| **Attach Node Agent** | Attach to plugin-spawned Agent (`127.0.0.1:6499`) |
| **Attach JCEF** | Attach to sandbox JCEF (`127.0.0.1:9222`) |
| **Run Tests** / **Run Verifications** | Tests and checks |

### UI hot reload

The classpath scheme (`http://vibefly/`) cannot proxy WebSocket, so in dev JCEF loads Vite directly:

```bash
# Terminal 1
./gradlew runVibeflyUiDev

# Terminal 2
./gradlew :plugin:runIde -Pvibefly.ui.dev=true
# or custom: -Pvibefly.ui.dev.url=http://127.0.0.1:5173/
```

Production still uses `http://vibefly/index.html` (static assets in the jar).

### Agent debugging

```bash
./gradlew :plugin:runIde -Pvibefly.debug=true
# or -Pvibefly.agent.inspect=6499
```

- VS Code: `.vscode/launch.json` → **Attach vibefly-agent**, fixed port `6499`
- IntelliJ IDEA: run **Attach Node Agent**, fixed port `6499` (no dynamic Inspector URL)
- Browser: attach Node.js Inspector / VS Code Node debugger to the `ws://…` URL in logs

### Logging

| Component | Mechanism | Level override |
| --- | --- | --- |
| Agent | winston → **stderr only** | `VIBEFLY_LOG_LEVEL` |
| UI | loglevel → Host `logFromWeb` | `localStorage.vibefly.log.level` / `VIBEFLY_LOG_LEVEL` |

### Docs

- [docs/](./docs/README.en.md) — architecture, development, RPC, Agent, settings ([中文](./docs/README.md))
- [packages/vibefly-agent](./packages/vibefly-agent/README.en.md) · [中文](./packages/vibefly-agent/README.md)
- [packages/vibefly-ui](./packages/vibefly-ui/README.en.md) · [中文](./packages/vibefly-ui/README.md)
- [packages/vibefly-uiagent-shared](./packages/vibefly-uiagent-shared/README.md) · [中文](./packages/vibefly-uiagent-shared/README.zh-CN.md)
- [packages/vibefly-simplerpc/SimpleRpc.md](./packages/vibefly-simplerpc/SimpleRpc.md)

### Conventions

- First-party packages in this repo are prefixed with `vibefly-`
- Upstream pi is consumed via npm; customization lives in `vibefly-*` adapters, not upstream package trees
- If a patch is required: prefer package-manager patch / a dedicated patch dir, and document source and reason

## Roadmap (excerpt)

- [x] JCEF WebView + SimpleRpc three channels
- [x] Node.js Agent (pi) subprocess management
- [x] Commit Message generation
- [x] Selection / file context injection
- [ ] Multi-session tabs and FIFO scheduling
- [ ] Multi theme colors (default: follow IDE)
- [ ] Process-level sandbox

## License & acknowledgements

- Plugin scaffold based on [IntelliJ Platform Plugin Template](https://github.com/JetBrains/intellij-platform-plugin-template)
- Engine: [pi](https://github.com/earendil-works/pi)

---

Issues and ideas: [GitHub Issues](https://github.com/sandogeek/jetbrains-vibe-fly/issues).
