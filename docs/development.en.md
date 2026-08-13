# Development guide

中文版：[development.md](./development.md)

## Prerequisites

- JDK **21+**
- Node.js **≥ 22**
- pnpm **≥ 9** (root `package.json` `packageManager`; recommend `corepack enable`)
- Access to IntelliJ Platform dependencies (pulled by Gradle)

## Bootstrap

```bash
corepack enable   # if not already enabled
pnpm install
pnpm run build:simplerpc
pnpm run build:shared
```

Gradle builds UI / Agent before packaging resources; without `pnpm install`, related tasks may skip and log.

## Common commands

### Root (pnpm)

```bash
pnpm run build:simplerpc   # @sandogeek/simple-rpc + simple-rpc-node
pnpm run build:shared      # @vibefly/uiagent-shared
pnpm run build:agent
pnpm run build:ui
pnpm run typecheck         # all packages
pnpm run test              # all packages
```

### Per package

```bash
pnpm --filter @vibefly/agent run typecheck|build|test|start
pnpm --filter @vibefly/ui run dev|build|typecheck|test
pnpm --filter @vibefly/uiagent-shared run generate|generate:check|typecheck|test
```

- Agent / UI tests: `node --import tsx --test 'src/**/*.test.ts'`
- Shared: `generate:check` ensures `contracts.generated.ts` matches contracts

### Gradle / plugin

```bash
./gradlew :plugin:runIde              # IDE sandbox
./gradlew :plugin:buildPlugin         # zip → plugin/build/distributions/
./gradlew :plugin:test
./gradlew :vibefly-jcef:generateVibeflyUiRpc
./gradlew runVibeflyUiDev             # Vite HMR only
```

| Property | Purpose |
| --- | --- |
| `-Pvibefly.ui.dev=true` | JCEF loads Vite (default `http://127.0.0.1:5173/`) |
| `-Pvibefly.ui.dev.url=...` | Custom UI dev URL |
| `-Pvibefly.debug=true` / `-Pvibefly.agent.inspect=6499` | Agent Node inspector on port **6499** |

## Run Configurations (`.run/`)

| Config | Purpose |
| --- | --- |
| **Run Plugin** | Plugin sandbox |
| **Run Plugin + UI Dev** | Sandbox + Vite HMR (recommended when editing UI) |
| **Run UI Dev** | Vite only |
| **Attach Node Agent** | Attach to Agent (`127.0.0.1:6499`) |
| **Attach JCEF** | Attach to sandbox JCEF (`127.0.0.1:9222`) |
| **Run Tests** / **Run Verifications** | Tests and checks |

## UI hot reload

The classpath scheme (`http://vibefly/`) **cannot proxy WebSocket**, so in development JCEF connects to Vite directly:

```bash
# Terminal 1
./gradlew runVibeflyUiDev

# Terminal 2
./gradlew :plugin:runIde -Pvibefly.ui.dev=true
```

Or use **Run Plugin + UI Dev**. Production still serves jar resources: `http://vibefly/index.html`.  
UI build output: `packages/vibefly-jcef/src/main/resources/web` (gitignored).

With `ui.dev`, `runIde` runs `waitVibeflyUiDevServer` (default wait on `127.0.0.1:5173`, ~60s timeout) and does **not** start Vite automatically.

## Agent debugging

```bash
./gradlew :plugin:runIde -Pvibefly.debug=true
# or -Pvibefly.agent.inspect=6499
```

- IntelliJ: **Attach Node Agent** (port 6499)
- VS Code: `.vscode/launch.json` → **Attach vibefly-agent**
- Browser: Node Inspector / `ws://…` from logs

## Codegen

| Contract | Command | Output |
| --- | --- | --- |
| Host ↔ UI | `./gradlew :vibefly-jcef:generateVibeflyUiRpc` | `packages/vibefly-ui/src/generated/rpc.ts` |
| Host ↔ Agent control | Gradle `generateVibeflyAgentControlRpc` (in packaging chain) | `packages/vibefly-agent/src/generated/controlRpc.ts` |
| UI ↔ Agent | `pnpm --filter @vibefly/uiagent-shared run generate` | `contracts.generated.ts` |

After changing `contracts.ts`, re-generate and keep `generate:check` green.

## Logging

| Component | Library | Output | Level override |
| --- | --- | --- | --- |
| Agent | winston | **stderr only** | `VIBEFLY_LOG_LEVEL` |
| UI | loglevel → Host `logFromWeb` | console + host | `localStorage.vibefly.log.level` / `VIBEFLY_LOG_LEVEL` |

```bash
VIBEFLY_LOG_LEVEL=debug   # Agent
```

```js
localStorage.setItem("vibefly.log.level", "debug")  // UI, takes effect after refresh
```

## Conventions

- Follow the style of the current file / package; no drive-by whole-repo reformatting.
- TS: `"type": "module"`, modern TS (~5.8).
- UI: React 19, Tailwind v4, `cn()`, Lucide, assistant-ui; **do not** switch to single-file bundling.
- Kotlin: JVM 21; EDT helpers in `util/Edt.kt`.
- i18n: plugin `plugin/src/main/resources/messages/`; UI `packages/vibefly-ui/src/i18n/`.
- Tests: agent/ui `*.test.ts` next to sources; plugin tests in `plugin/src/test/kotlin`.
- Do not commit secrets, `dist/`, or `resources/web/`.
- **Do not** force-push, change git config, or commit unless the user asks.

## Pre-merge checklist

1. Changed TS packages: `pnpm --filter <pkg> run typecheck` (and `test` for behavior changes).
2. Contract changes: re-generate + `generate:check`.
3. Host↔UI RPC: re-run Gradle generate.
4. Kotlin: when feasible `./gradlew :plugin:test` or targeted compile.
5. Agent I/O changes: confirm logs still never write stdout.
6. Optional full tree: `pnpm run typecheck` / `pnpm run test`.

## Where to change what

| Goal | Start here |
| --- | --- |
| Chat / tool UX | `packages/vibefly-ui/src/` |
| Agent sessions, tools, pi bridge | `packages/vibefly-agent/src/` |
| UI↔Agent RPC | `packages/vibefly-uiagent-shared/src/contracts.ts` → generate |
| Host↔UI RPC | `packages/vibefly-jcef` + re-generate |
| Agent process | `plugin/.../agent/` |
| Settings (host) | `plugin/.../settings/`; UI `packages/vibefly-ui/src/settings/` |
| Commit Message | `plugin/.../commit/` + agent `commitMessage.ts` |
| SimpleRpc core | `packages/vibefly-simplerpc/` |
