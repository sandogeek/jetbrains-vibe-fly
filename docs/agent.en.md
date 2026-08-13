# Node Agent

The Agent is a **Node.js child process** started by the plugin, embedding the [pi](https://github.com/earendil-works/pi) coding-session engine. Package: `packages/vibefly-agent` (`@vibefly/agent`).

中文版：[agent.md](./agent.md)

## Responsibility boundaries

| Plane | Protocol | What it does |
| --- | --- | --- |
| Control | SimpleRpc over **stdio** | Open/close WebSocket sessions, shutdown, Commit Message, Providers snapshot & login |
| Business | SimpleRpc over **WebSocket** | Chat turns, tool approval, streaming events |
| Internal | pi SDK | `createAgentSession`, models, tools, extensions |

**Does not**: drive IDE UI directly or call the full IDE API (host capabilities go through JCEF `Ui2Host`).

## Process lifecycle

### Current

- `VibeflyAgentService`: `@Service(Service.Level.PROJECT)` — **one** coding agent **per Project**.
- `VibeflyAgentProcess`: starts Node via `ProcessBuilder`; on shutdown calls `control.shutdown()` (short timeout), then destroys the process.
- Path resolution: `VibeflyAgentPaths` (Node binary, entry script).
- Agent data directory: `VibeflyAgentDirectory` → `~/.vibefly/<productCode lowercase>/agent`.

### Planned (not yet treated as implemented)

`docs/setting.md` describes a **standalone settings agent** (stays up after IDE start, not dependent on `withControlForSettings`). Today, settings-related Providers work still **borrows a project agent** (`withControlForSettings`). See [setting.en.md](./setting.en.md).

## Entry & I/O

- Entry: `src/main.ts` (stdio peer + control-plane service registration).
- **stdout**: SimpleRpc Content-Length frames only.
- **stderr**: winston logs; `console.*` is redirected to stderr at entry so third-party code cannot pollute the protocol stream.
- Business: `src/ws.ts` listens on loopback WS, validates the one-time ticket, then mounts `Ui2Agent` / pushes `Agent2Ui`.

```bash
# Run in foreground (manual integration)
pnpm --filter @vibefly/agent run start
# or
node --import tsx packages/vibefly-agent/src/main.ts
```

## Sessions & scheduling

| Module | Role |
| --- | --- |
| `chatSessionRegistry.ts` | Per-session pi `createAgentSession`, tool approval, write-path constraints, etc. |
| `chatScheduler.ts` | `SerialTurnScheduler`: **one active turn** per project, FIFO queue by session |
| `commitMessage.ts` | Commit Message generation triggered from the control plane |
| `providerConfig.ts` / `providerLogin.ts` | models/auth and login flows |

Intent: multiple tab sessions per project are allowed, but **turns run serially** to reduce concurrent file-edit conflicts.

Full mapping of pi `AgentSessionEvent` → `ChatEvent` → UI → assistant-ui: [chat-messages.en.md](./chat-messages.en.md).

## Control flow with Host (conceptual)

```text
UI needs to connect to Agent
  → Ui2Host.getAgentConnection (or equivalent)
  → Host: VibeflyAgentService ensures process is alive
  → Host2Agent.openWebSocketSession
  → Agent binds 127.0.0.1 port + ticket
  → Host returns endpoint to UI
  → UI opens WebSocket; business RPC starts
```

Shutdown: Host `shutdown` / process exit → in-flight requests fail; UI should reconnect or prompt.

## Debugging

```bash
./gradlew :plugin:runIde -Pvibefly.debug=true
# or -Pvibefly.agent.inspect=6499
```

- IntelliJ: **Attach Node Agent** (`6499`)
- VS Code: **Attach vibefly-agent**
- Log level: `VIBEFLY_LOG_LEVEL=debug` (stderr only)

## Dependencies & customization

- Engine: `@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai`, etc.
- RPC: `@sandogeek/simple-rpc-node`
- Logging: `winston`

**Do not** modify upstream pi source under `node_modules`. If a patch is required, use the package manager’s patch mechanism / a dedicated patch directory and document why. In-repo adapters belong only in `vibefly-agent` and other `vibefly-*` packages.

## Related docs

- Package README: [packages/vibefly-agent/README.md](../packages/vibefly-agent/README.md)
- Channel details: [rpc.en.md](./rpc.en.md)
- Architecture overview: [architecture.en.md](./architecture.en.md)
