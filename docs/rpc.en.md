# SimpleRpc three channels

All cross-process / cross-WebView communication uses **SimpleRpc** (`packages/vibefly-simplerpc`). Do not introduce a second RPC stack.

Service naming: **`Caller2Callee`** (e.g. `Ui2Host`, `Host2Ui`, `Ui2Agent`, `Agent2Ui`, `Host2Agent`).

中文版：[rpc.md](./rpc.md)

## Channel map

```text
  WebView UI                    Host (Kotlin)                 Node Agent
  ─────────                     ─────────────                 ──────────
       │  Ui2Host / Host2Ui           │                            │
       │◄──── JCEF MessageRouter ────►│                            │
       │                              │  Host2Agent / Agent2Host   │
       │                              │◄──── stdio (Content-Length)─►│
       │                                                              │
       │  Ui2Agent / Agent2Ui                                         │
       │◄──────── WebSocket 127.0.0.1 + one-time ticket ─────────────►│
```

| Channel | Transport | Contract location | Generated output |
| --- | --- | --- | --- |
| UI ↔ Host | JCEF MessageRouter | Kotlin: `Ui2Host` / `Host2Ui` in `vibefly-jcef` | `packages/vibefly-ui/src/generated/rpc.ts` |
| Host ↔ Agent | stdio Content-Length | Kotlin: `Host2Agent` / `Agent2Host` | `packages/vibefly-agent/src/generated/controlRpc.ts` |
| UI ↔ Agent | WebSocket | **TS only**: `vibefly-uiagent-shared` | `contracts.generated.ts` |

## 1. Host plane: UI ↔ Host

**Purpose**: IDE capabilities only (keep the Agent off the full IDE API over WS).

Typical capabilities (code is source of truth):

- Theme, logs (`logFromWeb`), open external URL
- Agent connection info (WS URL + ticket)
- Context, open file / Diff, theme, logs (`logFromWeb`)
- State push (`Host2Ui`)

**Implementation notes**:

- UI: `packages/vibefly-ui/src/rpc/client.ts` (`createCefSimpleRpc`)
- Host: `VibeflyBrowserPanel` mounts `CefMessageRouter`; implements `Ui2HostImpl`, etc.
- Each panel owns `window.vibeflyCefQuery_<channel>`; channel comes from the launch URL so the settings page and tool window do not share one session

Generate:

```bash
./gradlew :vibefly-jcef:generateVibeflyUiRpc
```

## 2. Control plane: Host ↔ Agent

**Purpose**: lifecycle and Host-proxied capabilities; **does not** carry the chat stream.

Typical RPC (code is source of truth):

| Direction | Examples |
| --- | --- |
| Host → Agent | `openWebSocketSession`, `shutdown`, `generateCommitMessage`, `getProvidersSnapshot(modelsJson, authJson)`, `applyProvidersPatch(request, modelsJson, authJson)`, login-related |
| Agent → Host | Control-plane callbacks (if any) |

**stdio rules**:

- JVM → Node: child process **stdin**
- Node → JVM: child process **stdout**
- Frame format: UTF-8 JSON + **Content-Length** headers (not newline-delimited)
- **No logs on stdout**; winston / `console` go to stderr only (`main.ts` redirects console)
- Abnormal process exit or stdio close → JVM ends the session and fails in-flight requests (`onClosed`)
- Control-plane timeouts are long (e.g. OAuth login ~6 minutes; trust the code)

Implementation: `StdioRpcTransport` (Kotlin) + `@sandogeek/simple-rpc-node`.

## 3. Business plane: UI ↔ Agent

**Purpose**: chat, tools, streaming events. Streaming shapes and assistant-ui adaptation: [chat-messages.en.md](./chat-messages.en.md).

**Connection flow (conceptual)**:

1. UI asks Host for connection info via `Ui2Host`.
2. Host calls `Host2Agent.openWebSocketSession` so Agent opens WS on `127.0.0.1` and issues a **one-time ticket**.
3. UI connects with the ticket, then uses `Ui2Agent` / `Agent2Ui`.

Writing contracts (`packages/vibefly-uiagent-shared`):

- Define services in `contracts.ts` with abstract classes + `@rpcService()` / `@rpcId(n)`.
- Methods need a discardable body (TS decorator constraint); keep classes `abstract`.
- After changes: `pnpm --filter @vibefly/uiagent-shared run generate`
- CI / typecheck: `generate:check`
- Optional wire name: `@rpcService("WireName")`
- Control params via `rpcOptions(...)`; the generator strips them from the wire signature

**Forbidden**: Kotlin mirror types for UI↔Agent interfaces.

## Payload principles

- For large files, prefer **paths, ranges, and checksums** over Base64 in JSON.
- Streaming events go on the business plane; do not block the control plane.

## Checklist when changing contracts

1. Change `contracts.ts` → generate + typecheck (ui + agent + shared).
2. Change `Ui2Host` / `Host2Ui` → `generateVibeflyUiRpc` + compile plugin and UI.
3. Change `Host2Agent` / `Agent2Host` → control-plane codegen + agent typecheck.
4. Confirm there is no second ad-hoc messaging protocol.

Deeper SimpleRpc semantics: [packages/vibefly-simplerpc/SimpleRpc.md](../packages/vibefly-simplerpc/SimpleRpc.md).
