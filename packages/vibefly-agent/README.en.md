# @vibefly/agent

English | [中文](./README.md)

Vibe Fly Node agent: bridges [pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`) and talks to the JVM plugin over SimpleRpc stdio.

## Responsibilities

Service naming: `Caller2Callee` (caller → callee).

| Direction | Protocol | Notes |
| --- | --- | --- |
| Host → Agent | SimpleRpc `Host2Agent` (stdio) | `openWebSocketSession` / `shutdown` |
| UI → Agent | SimpleRpc `Ui2Agent` (WebSocket) | `ping` / chat session APIs |
| Agent → UI | SimpleRpc `Agent2Ui` (WebSocket) | `onChatEvents` / permission / input |
| Agent internal | pi SDK | `createAgentSession` + session events |

Rules (see repo `设想.md`):

- `stdout` carries SimpleRpc Content-Length frames only
- All logs go to `stderr` (winston; never pollute stdout)
- The plugin starts and owns the Node.js child process

## Logging

Uses [winston](https://github.com/winstonjs/winston), entry `src/log.ts`.

| Item | Notes |
| --- | --- |
| Default level | `info` |
| Override | env `VIBEFLY_LOG_LEVEL` (`error` / `warn` / `info` / `http` / `verbose` / `debug` / `silly`; invalid → `info`) |
| Output | **stderr only**, human-readable: `[vibefly-agent] <timestamp> INFO message …` |
| stdout | No logging; `stdoutIsolation.ts` redirects `console.log` / `info` / `debug` and other stdout methods to stderr so third parties cannot corrupt SimpleRpc |
| commit dump | model/budget summary at `info`; full systemPrompt / messages only at `debug` (and lower) |

```bash
VIBEFLY_LOG_LEVEL=debug pnpm run start
```

## Layout

```
packages/vibefly-agent/
  package.json
  tsconfig.json
  src/
    main.ts         # entry: stdio peer
    log.ts          # winston logger (stderr-only)
```

## Development

Requires Node.js ≥ 22 and pnpm ≥ 9.

```bash
# repo root
pnpm install
pnpm run build:simplerpc
pnpm run build:shared

pnpm --filter @vibefly/agent run typecheck
pnpm --filter @vibefly/agent run build
pnpm --filter @vibefly/agent run start   # foreground stdio for plugin child or manual wiring
```

### Manual wiring

The plugin starts the process with `ProcessBuilder`, e.g.:

```text
node --import tsx /path/to/packages/vibefly-agent/src/main.ts
# or
node /path/to/packages/vibefly-agent/dist/main.js
```

stdin/stdout is the Content-Length SimpleRpc control plane (`Host2Agent`); business RPC is WebSocket (`Ui2Agent` / `Agent2Ui`).

### Debugging

#### IntelliJ / VS Code (Node.js debugger)

Debug `src/main.ts` with a Node.js debugger or a VS Code Node.js launch/attach config.

#### VS Code / browser (attach to plugin-spawned agent)

```bash
./gradlew :plugin:runIde -Pvibefly.debug=true
# or -Pvibefly.agent.inspect=6499
```

- IntelliJ IDEA: `.run/Attach Node Agent.run.xml` → **Attach Node Agent** (fixed port `6499`)
- VS Code: `.vscode/launch.json` → **Attach vibefly-agent** (fixed port `6499`)
- Browser: open the `ws://...` URL from logs with Node.js Inspector

## Dependencies

- `@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai`: engine
- `@sandogeek/simple-rpc-node`: stdio Content-Length + peer (this repo `packages/vibefly-simplerpc`)
- `winston`: stderr logging

Customization and bridging stay in this package; do not modify upstream pi package paths.
