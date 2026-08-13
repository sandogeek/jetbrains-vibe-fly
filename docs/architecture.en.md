# Architecture

Slogan: *Vibe coding on the fly*. A JetBrains IDE–first vibe coding plugin built on the [pi](https://github.com/earendil-works/pi) engine.

中文版：[architecture.md](./architecture.md)

## Overview

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

| Layer | Stack | Role |
| --- | --- | --- |
| **Host** | Kotlin, IntelliJ Platform | Lifecycle, IDE capabilities, Agent process, settings persistence, VCS |
| **UI** | React / Vite / JCEF | Chat, settings pages, theme, context display |
| **Agent** | Node.js + pi | Sessions, tools, models, streaming events, Providers |

## Three channels (all SimpleRpc)

| Channel | Transport | Example service names | Role |
| --- | --- | --- | --- |
| Host ↔ Agent | stdio (Content-Length) | `Host2Agent` / `Agent2Host` | Control plane: open WS sessions, shutdown, Commit Message, Providers / login |
| WebView ↔ Host | JCEF MessageRouter | `Ui2Host` / `Host2Ui` | Host plane: settings, context, open file / Diff, theme, logs |
| WebView ↔ Agent | WebSocket (`127.0.0.1` + one-time ticket) | `Ui2Agent` / `Agent2Ui` | Business plane: chat, tool approval, streaming events |

Hard rules:

1. Agent **`stdout` carries protocol frames only**; all logs go to **stderr** (winston).
2. Service names are **`Caller2Callee`**.
3. **UI ↔ Agent contracts are TypeScript only** (`packages/vibefly-uiagent-shared`); do not mirror these APIs in Kotlin.
4. **UI ↔ Host contracts** live in `packages/vibefly-jcef`; generate TS with `./gradlew :vibefly-jcef:generateVibeflyUiRpc`.
5. Prefer paths / ranges in JSON payloads; avoid large binary Base64.
6. Do not modify upstream pi source; put customizations in `vibefly-*` adapters or hooks/extensions.

See [rpc.en.md](./rpc.en.md).

## Repo map

| Path | Stack | Role |
| --- | --- | --- |
| `plugin/` | Kotlin | Tool Window, Actions, settings State, VCS, Agent process management |
| `packages/vibefly-jcef/` | Kotlin | JCEF panel, `http://vibefly/` scheme, Host↔UI / Host↔Agent control RPC |
| `packages/vibefly-agent/` | Node/TS | pi runtime + stdio / WS bridge, sessions & scheduling |
| `packages/vibefly-ui/` | React/Vite/TS | WebView UI |
| `packages/vibefly-uiagent-shared/` | TS | UI↔Agent shared contracts |
| `packages/vibefly-simplerpc/` | Kotlin + TS | SimpleRpc transport and codegen |
| `docs/` | Markdown | This directory |

Kotlin package root: `com.github.sandogeek.jetbrainsvibefly`.  
Own package prefix: `vibefly-` (npm: `@vibefly/*`, SimpleRpc: `@sandogeek/simple-rpc*`).

## Key subsystems (path cheat sheet)

| Subsystem | Main entry points |
| --- | --- |
| Agent lifecycle | `plugin/.../agent/VibeflyAgentService.kt`, `VibeflyAgentProcess.kt`, `VibeflyAgentPaths.kt`, `VibeflyAgentDirectory.kt` |
| Control-plane RPC | `vibefly-jcef/.../rpc/Host2Agent.kt`, `Agent2Host.kt`; Agent `src/generated/controlRpc.ts`, `main.ts` |
| Host-plane RPC | `vibefly-jcef/.../rpc/Ui2Host.kt`, `Host2Ui.kt`, `Ui2HostImpl.kt`; UI `src/generated/rpc.ts`, `src/rpc/client.ts` |
| Business-plane RPC | `vibefly-uiagent-shared/src/contracts.ts`; UI `src/rpc/agent.ts`; Agent `src/ws.ts` |
| JCEF | `VibeflyBrowserPanel.kt`, `VibeflyScheme.kt`, `ClasspathResourceHandler.kt`, `VibeflyUiDev.kt` |
| Settings (current) | `plugin/.../settings/*`; UI `packages/vibefly-ui/src/settings/*` |
| Chat workspace | `plugin/.../chat/ChatWorkspaceState.kt`, `ChatContextDeliveryService.kt` |
| Sessions / scheduling | Agent `chatSessionRegistry.ts`, `chatScheduler.ts`; UI `src/chat/*` |
| Message adapter | Agent events → wire → assistant-ui: see [chat-messages.en.md](./chat-messages.en.md) |
| Commit Message | `plugin/.../commit/*`; Agent `commitMessage.ts` |

## Data & directories

| Item | Notes |
| --- | --- |
| Agent working dir | `~/.vibefly/<productCode lowercase>/agent` (see `VibeflyAgentDirectory`) |
| Node resolution | `-Dvibefly.node` → common paths → `PATH` (`VibeflyAgentPaths`) |
| Agent entry | `-Dvibefly.agent.entry` → packaged `agent/dist/main.js` → monorepo source |
| Providers files | `models.json` / `auth.json` under Host application settings dir; Host owns persistence; Agent accesses via stdio snapshot / credential adapters |
| UI production assets | `packages/vibefly-jcef/src/main/resources/web` (gitignored, build output) |

## Sessions & scheduling (summary)

- One Node coding agent per Project (`VibeflyAgentService`, `Service.Level.PROJECT`).
- UI multi-tab sessions (cap ~8); workspace state in `ChatWorkspaceState` (PROJECT-level).
- Agent `SerialTurnScheduler`: **serial** turns per project (FIFO) to avoid concurrent code edits.
- Editor / drag context is buffered by Host and delivered to the active session after the page binds.

Details: [agent.en.md](./agent.en.md). How pi streaming events become assistant-ui messages: [chat-messages.en.md](./chat-messages.en.md).

## Mental model (four points)

1. The **plugin** integrates with the IDE and starts the **Node agent** (per project; settings-related behavior in [setting.en.md](./setting.en.md)).
2. The **control plane (stdio)** only handles WS session open/close, shutdown, and some Host-proxied capabilities (Commit / Providers).
3. The **business plane (WS)** carries chat and streaming events; contracts come from **uiagent-shared**.
4. The **host plane (JCEF)** exposes only IDE capabilities so the Agent does not get the full IDE API over WS.
