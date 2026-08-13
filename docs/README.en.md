# Vibe Fly Docs

Design and implementation notes live here. **Runtime truth is the code**; if docs and code disagree, prefer the code and update the docs.

| Doc | Contents |
| --- | --- |
| [architecture.en.md](./architecture.en.md) | Three-layer architecture, channel roles, repo map |
| [development.en.md](./development.en.md) | Environment, build, Run Configs, HMR, debugging, logging |
| [rpc.en.md](./rpc.en.md) | SimpleRpc three channels, service naming, contracts & codegen |
| [agent.en.md](./agent.en.md) | Node Agent lifecycle, sessions, scheduling, stdio rules |
| [chat-messages.en.md](./chat-messages.en.md) | pi events → ChatEvent → assistant-ui message adapter |
| [setting.en.md](./setting.en.md) | Settings: current implementation, design goals, gaps & TODOs |

中文版：[README.md](./README.md)

## Related entry points

| Path | Notes |
| --- | --- |
| [README.en.md](../README.en.md) · [中文](../README.md) | User-facing: features, install, development summary |
| [设想.md](../设想.md) | Early vision & roadmap (part shipped, part still planned) |
| [AGENTS.md](../AGENTS.md) | Conventions for coding agents |
| [packages/*/README.md](../packages/) · `README.en.md` | Per-package notes |

## When writing docs

1. Mark **current** vs **planned**; do not treat `设想.md` / TODOs as shipped.
2. Service names follow `Caller2Callee`; UI↔Agent contracts live only in TypeScript (`vibefly-uiagent-shared`).
3. Agent `stdout` is protocol frames only; logs go to stderr.
4. Keep docs small and focused; update the matching doc when implementation changes.
