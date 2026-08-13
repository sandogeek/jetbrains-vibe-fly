# Host-centralized settings architecture

This document describes the current settings system and the boundaries of settings consumers. Host-owned persistence, four-file layout, revision protocol, and credential isolation are shipped; product capabilities not provided in this round are called out explicitly.

中文版：[setting.md](./setting.md)

## Goals and constraints

1. Host is the sole writer of application / project config files and holds in-memory snapshots for both scopes.
2. UI and Agent only read, save, and subscribe via existing SimpleRpc; they never touch settings files directly.
3. pi-native fields live in `settings.json`; Vibe Fly–specific fields live in `settings.vibefly.json`; model definitions and credentials live in `models.json` and `auth.json` respectively. Upstream pi types/source are not modified.
4. Only `settings.json` and `settings.vibefly.json` support project overrides: objects deep-merge recursively; arrays, scalars, and `null` are wholly replaced by the project layer. `models.json` and `auth.json` are application-only.
5. Host pushes only small invalidation notices; consumers re-fetch snapshots over RPC and do not receive full config in the notice.
6. Saves use opaque revision for optimistic concurrency, with file locks, same-directory temp files, and atomic replace.
7. Settings hot-reload must not restart all Agents.
8. Session and workspace state are outside the config snapshot.

UI → Agent business contracts still live only in `packages/vibefly-uiagent-shared`; no Kotlin mirrors. Settings reads belong to UI → Host and Agent → Host; do not introduce a second RPC stack for this.

## Current implementation boundaries

- Settings and chat pages consume Host snapshots through the same UI runtime; Agent consumes trusted snapshots through the same shared sync core.
- All current UI settings writes are fixed to application scope. Typed keys already record legal scopes and support `unset`, but this round does not show Global / Project switching, inheritance source, or “restore inheritance” entry points.
- Settings WebView starts with `hasProject: false`; Chat WebView with `hasProject: true`. Effective fields such as locale can therefore read project overrides on the chat page; pin / MRU always read the application layer.
- Provider login lifecycle uses the settings tab's project agent `withControl` and reverse RPC. Provider config and revision convergence are already on the unified UI client.
- No read or migration of old IDE XML settings; session / workspace state is also outside this system.

## Files and scopes

`<product>` uses the normalized IDE product code already provided by `VibeflyAgentDirectory`. Fixed layout:

```text
~/.vibefly/<product>/agent/
  settings.json
  settings.vibefly.json
  models.json
  auth.json
  sessions/            # not part of the config snapshot

<project>/.vibefly/
  settings.json
  settings.vibefly.json
```

| scope | `settings.json` | `settings.vibefly.json` | `models.json` | `auth.json` |
| --- | --- | --- | --- | --- |
| `application` | `~/.vibefly/<product>/agent/settings.json` | `~/.vibefly/<product>/agent/settings.vibefly.json` | `~/.vibefly/<product>/agent/models.json` | `~/.vibefly/<product>/agent/auth.json` |
| `project` | `<project>/.vibefly/settings.json` | `<project>/.vibefly/settings.vibefly.json` | not supported | not supported |

Project settings do **not** use pi-native `<project>/.pi/settings.json`. The Agent feeds Host snapshots to pi via Host-backed storage so neither pi nor the Agent bypasses Host for another project config source.

`settings.json` stores only known pi `Settings` fields (default Provider / Model, thinking, compaction, retry, enabled models, etc.).  
`settings.vibefly.json` stores product fields such as Commit Message, pin / MRU, and UI locale. `models.json` stores Provider / Model definitions; `auth.json` stores credentials only. Credentials must not enter the other three files.

**Invariant:** `settings.json` and `settings.vibefly.json` **must not** hold credentials or secret-bearing fields. Host passthroughs these documents to the UI (JSON syntax / object root checks only) without field whitelist projection; UI saves replace whole provided documents.

### Merge semantics

The two files for application and project merge independently:

```text
effectiveSettings = deepMerge(application.settingsJson, project.settingsJson)
effectiveVibefly = deepMerge(application.vibeflyJson, project.vibeflyJson)
effectiveModels = application.modelsJson
effectiveAuth = application.authJson
```

- Missing project file or key inherits the application value.
- When both sides are JSON objects, merge key-by-key recursively.
- A project array replaces the entire application array (no element-wise merge).
- Project string, number, boolean, and `null` replace the application value.
- `models.json` and `auth.json` never read a project layer or merge; all project Agents share the current product’s application snapshot.
- Unknown keys must be preserved for forward evolution of pi or Vibe Fly schemas.
- No cross-file merge and no stuffing a `vibefly` namespace into pi `settings.json`.

Merge algorithm and schema are implemented once in `packages/vibefly-uiagent-shared` for UI and Agent. Kotlin Host only validates JSON syntax, manages raw documents and generic RPC DTOs, and does not mirror the full TypeScript schema.

## Host services and snapshots

### Lifecycle

Host provides two service levels:

- One application service for the IDE application lifetime; loads the four application files at start and watches them.
- One project service per open project; loads the two files under `<project>/.vibefly/`; releases watchers and subscriptions when the project closes.
- Project service depends on application service. When the application snapshot changes, every project consumer’s effective cache must invalidate.

Application service caches four raw JSON documents; project service caches two. When consumers request project config they fetch application and project snapshots separately, then shared `SettingsSyncClient` computes effective config. UI and Agent therefore share identical override rules without inventing a project layer for `models.json` / `auth.json`.

### Snapshot model

RPC uses raw JSON strings and opaque revisions so Kotlin does not copy the full settings schema. Conceptual model:

```ts
type SettingsScope = "application" | "project"

type SettingsDiagnostic = {
  file: "settings.json" | "settings.vibefly.json" | "models.json" | "auth.json"
  severity: "error" | "warning"
  message: string
}

type ApplicationSettingsSnapshot = {
  scope: "application"
  projectRoot: null
  settingsJson: string
  vibeflyJson: string
  modelsJson: string
  authJson: string
  revision: string
  diagnostics: SettingsDiagnostic[]
}

type ProjectSettingsSnapshot = {
  scope: "project"
  projectRoot: string
  settingsJson: string
  vibeflyJson: string
  revision: string
  diagnostics: SettingsDiagnostic[]
}

type SettingsSnapshot = ApplicationSettingsSnapshot | ProjectSettingsSnapshot
```

- Application snapshots must have `projectRoot: null`; project snapshots must carry a normalized absolute project root.
- Each `*Json` field is the last valid raw JSON for that scope, not the merged result.
- Project snapshots have no `modelsJson` / `authJson`; project versions of those must be rejected on input or write.
- Missing files yield `{}` for that raw layer without error.
- `revision` is for equality only; consumers must not parse, sort, or invent revisions.
- Any observable content or diagnostics change must change revision; no-op duplicate watcher events must not mint a new revision.

Effective project revision is composed from application revision and project revision and exists only in shared `SettingsSyncClient` cache. Either layer change invalidates the effective cache.

The types above are the full model for Host internals and the trusted Agent. Providers RPC returns a complete single Provider entry (`configJson` = `models.json.providers[id]` object, which may include `apiKey`, headers, unknown fields); `auth.json`, OAuth tokens, and the credential store never enter the WebView—only redacted auth status (`ProviderCredentialStatus`). UI and Agent projections share the same scope revision so the UI still invalidates and refreshes when auth files change.

### Invalid JSON

Host always keeps the last successfully parsed content per file:

1. When the watcher sees invalid JSON, do not overwrite the last valid snapshot with the bad content.
2. Host updates diagnostics, mints a new revision, and still sends invalidation.
3. Consumers re-fetch and keep using last valid content while showing diagnostics.
4. If first load is invalid with no prior valid value, serve `{}` for that file.
5. After external edit repairs the file, Host clears that diagnostic, accepts new content, and notifies again.
6. RPC saves that are not valid JSON are rejected without writing disk or changing last valid snapshot.

One invalid file must not block updates to another file in the same scope.

### Watcher, lock, atomic write

- Use IntelliJ / OS file watchers on the four application files and two project files, covering create, modify, replace, and delete.
- Debounce bursts of events in the same scope before a merged read; debounce reduces work but must not swallow the final state.
- Reads and writes share one lock protocol. If the lock cannot be taken, retry with a bound; never read another process’s incomplete temp state.
- Writes create a temp file in the target’s directory, flush, then atomically replace; if atomic move is unavailable, log a warning and use a safe fallback.
- Application directory permissions stay user-only; `auth.json` must remain owner-only after create/replace; logs and diagnostics must never include file contents or secrets.
- Multi-file saves validate all JSON first, write under a scope-level mutex, then publish one new revision and notice.
- Watcher callbacks caused by Host’s own writes are deduped by content comparison so they do not re-bump revision or loop notifications.
- `projectRoot` is resolved and normalized only by Host from an opened IDE Project (UI JCEF session binding) or Agent-injected `VIBEFLY_PROJECT_ROOT`; UI / Agent request params must not carry arbitrary paths or escape `<project>/.vibefly/`.

## RPC contracts

All interfaces keep `Caller2Callee` service names and existing transports: JCEF MessageRouter for UI ↔ Host, stdio for Host ↔ Agent.

### Read and save

```text
Ui2Host.getSettingsSnapshot(scope) -> UiSettingsSnapshot
Ui2Host.saveSettings(request) -> SettingsSaveResult
Ui2HostSettings.applyProvidersPatch(request, expectedRevision) -> ProvidersPatchResult

Agent2Host.getSettingsSnapshot(scope) -> AgentSettingsSnapshot
Agent2Host.saveAuth(request) -> SettingsSaveResult
```

When `scope = "project"`, Host uses the session-bound project root: UI from the WebView’s Project; Agent from process env `VIBEFLY_PROJECT_ROOT`. Callers pass only `scope`, never a path. Project scope without a bound project is rejected.

UI save requests at least include:

```ts
type SettingsSaveRequest = {
  scope: SettingsScope
  settingsJson?: string
  vibeflyJson?: string
  expectedRevision: string
}
```

Neither `UiSettingsSnapshot` nor `SettingsSaveRequest` may contain raw `modelsJson` or `authJson`. UI reads full Provider entries (`configJson`) and auth status via Providers RPC; Provider edits use patches with `expectedRevision`, where `ProviderPatch.configJson` wholly replaces `models.json.providers[id]` (not field merge), preserving unknown keys as supplied. `UiSettingsSnapshot`’s `settingsJson` / `vibeflyJson` match disk raw documents (no field projection); `SettingsSaveRequest` whole-file replaces provided documents (omitted files unchanged). `AgentSettingsSnapshot` carries full application four files and project two files on the trusted local stdio control plane.

When the Agent logs in, logs out, or refreshes credentials, the Host-backed credential adapter uses dedicated `Agent2Host.saveAuth`, which allows only application scope, `authJson`, and `expectedRevision`. On conflict the adapter re-fetches the latest application snapshot, replays the provider-level change on the latest credentials map, and retries—never overwriting concurrent credential writes with a stale whole file.

Except for `Agent2Host.saveAuth`, the Agent is a read-only config consumer. All files are ultimately written by Host under the unified lock and atomic-write protocol; Agent’s pi storage, model registry, and credential store never write files directly.

Under lock, Host compares `expectedRevision` to the current scope revision:

- Equal: validate, write, update snapshot, return new revision.
- Unequal: reject with a clear revision conflict; caller re-reads, re-applies user edits, saves again.
- Project scope without a valid open project: reject.
- Providers patch at project scope, or any UI request carrying raw `modelsJson` / `authJson`: reject.

### Invalidation notices

```text
Host2Ui.settingsChanged(scope, projectRoot, revision) -> void
Host2Agent.settingsChanged(scope, projectRoot, revision) -> void
```

Notices carry no JSON. `projectRoot` is identity only: `null` for application, normalized absolute path for project—so consumers can key caches; callers do not echo paths back. Consumers compare revision and, if local is not that revision, re-fetch via the reverse RPC. Notices may be coalesced or duplicated; correctness depends on re-read, not on every event being delivered.

Any application file change must fan out to all settings panels, chat panels, and live project Agents. Each project `SettingsSyncClient` subscribes to both application scope and its own project scope, so application notices invalidate all project effective caches. Project notices go only to that project’s consumers.

`SettingsSyncClient.notify()` may receive notices before `start()` and keeps the latest target revision per scope; after the first snapshot it catches up. Reconnect still does a full initial read, so Host need not retain historical events.

## Shared TypeScript settings core

`packages/vibefly-uiagent-shared/src/settings/` keeps schema, typed keys, semantic mutation, and the sync client separate. This logic does not depend on browser, Node filesystem, or Kotlin:

- TypeScript schema and runtime validation for `settings.json`, `settings.vibefly.json`, `models.json`, and `auth.json`.
- Application / project object deep merge.
- Application-only constraints and no-merge semantics for `models.json` / `auth.json`.
- Raw snapshot, opaque revision, and effective revision management.
- Per-scope cache, invalidation, re-fetch, save queue, and selector subscriptions.
- Immutable update helpers that preserve unknown keys.
- Diagnostics aggregation.

Core APIs are `SettingsSyncClient<TSnapshot>` and `SettingsSyncAdapter<TSnapshot>`. Adapters provide `fetch(scope)`; writable consumers also provide `save(request)`. The UI adapter calls `Ui2Host` with the safe projection; the Agent adapter calls `Agent2Host` with the full projection. Both reuse revision, cache, and merge behavior without adding UI ↔ Agent settings RPC. `modelsJson`, `authJson`, and credential helpers export only from `@vibefly/uiagent-shared/agent` and never enter the WebView root bundle.

Same-scope fetch/save is serial; different scopes may run in parallel. `mutate()` replays semantic ops on the target raw layer by typed key; one request can save settings/vibefly together while preserving unknown keys; on conflict it re-fetches and replays up to four times. After a successful save it still fetches Host’s authoritative snapshot and never fabricates revision client-side. Selectors notify only when the selected value changes, so diagnostics-only revisions do not wake unrelated consumers.

Current typed keys cover default Provider/Model, four Commit Message fields, pin/MRU, and UI locale. Default model, Commit, and locale read from the effective layer; pin/MRU always read from application. Keys declare legal write scopes and `unset` semantics as a foundation for later “restore inheritance”.

## UI flow

### First load

1. WebView establishes `Ui2Host` / `Host2Ui` sessions.
2. UI adapter fetches redacted application snapshot; with project context, also fetches project snapshot.
3. `UiSettingsRuntime` composes the safe snapshot adapter, `SettingsSyncClient`, optimistic draft, and selector subscriptions; Providers page consumes only redacted models and auth status.
4. Diagnostics present separately from effective config; errors must not brick the whole settings page.

### Save

1. Form writes currently always target application scope; Provider / Model edits are also application-only.
2. `UiSettingsRuntime` hands typed mutations to `SettingsSyncClient`, applied on the application raw layer with unknown keys preserved.
3. UI calls `Ui2Host.saveSettings` with that layer’s read revision as `expectedRevision`.
4. On success, fetch Host’s authoritative snapshot; on conflict, auto-replay local semantic mutations on the latest layer up to four times.
5. Other panels refresh themselves via `Host2Ui.settingsChanged`.

General / Commit pages still use 300ms debounce and flush on unmount; Provider default model and chat pin/MRU enter the runtime’s unified save queue immediately. `IdeSettings` is only a view model projected from typed keys; it no longer owns JSON paths or revision retry.

`UiProviderSettingsClient` unifies Provider refresh, patch, and post login/logout application revision alignment. Provider patch replays conflicts up to four times; login/logout do not auto-retry. Provider snapshots are accepted only when the settings client has converged to the RPC-returned revision; after application invalidation, SettingsShell’s single subscription triggers a merged refresh.

## Agent and pi hot reload

After start, the Agent loads application four files and its project two files via `Agent2Host.getSettingsSnapshot`. `HostSettingsRuntime` subscribes once to shared sync state and composes three small bridges:

- `PiSettingsBridge`: serves recursively merged effective settings as pi `global` storage; pi `project` always returns `{}`; all pi writes are consumed and discarded.
- `ModelConfigBridge`: parses application `models.json`, updates the catalog via public pi `registerProvider()` / `unregisterProvider()`, and refuses to inject sensitive fields like `apiKey` into runtime registration. `ModelsStore` is a dynamic model-catalog cache, not a loader for `models.json`.
- `HostCredentialStore`: keeps pi `CredentialStore` provider-level modify/delete semantics, persists via `Agent2Host.saveAuth`, and re-fetches/replays on conflict.

Raw application/project layers are intentionally not handed to pi. pi 0.83 `SettingsManager` only shallow-merges nested global/project fields and cannot replace Vibe Fly’s recursive object merge; the shared layer therefore computes full effective settings, materializes them as pi global, and leaves project empty. Agent also maintains compile-time contract checks for pi 0.83 `SettingsManager.fromStorage` / `inMemory` params without depending on pi from the shared package or patching upstream.

On `Host2Agent.settingsChanged`:

1. `SettingsSyncClient` re-fetches the changed scope and produces one state transaction with previous/current.
2. Update `PiSettingsBridge` first.
3. Update application auth under the credential mutex; project invalidation must not roll back a just-persisted application credential.
4. On models change apply registration; on auth-only change run one `allowNetwork: false` runtime refresh.
5. On any semantic content change to settings/models/auth, reload live sessions at most once; models/auth changes also publish model catalog change. Diagnostics-only revisions do not reload.
6. A single session reload failure logs to stderr and is isolated—no Host snapshot rollback and no `stopAllOpenProjects()`.

New sessions always create from the latest effective snapshot. With no live sessions the Agent still updates cache so the next session needs no process restart.

pi login, logout, and token refresh write back through Host-backed credential store provider-level `modify` / `delete` via `Agent2Host.saveAuth`. After Host save succeeds it broadcasts application invalidation so other project Agents under the same product converge on new credentials.

Host-backed storage should use pi public extension points or in-repo `vibefly-*` adapters. Do not modify upstream package source; if upstream lacks the needed hook, follow repo rules with package-manager patches / a dedicated patch directory and document why.

## Startup and legacy state

No migration from IDE XML settings. Host runtime only recognizes JSON files; old XML state classes may be deleted or left idle after the code switch, but they do not participate in read, merge, or fallback.

1. Application service loads the four application files at start; missing files yield `{}` for that raw layer—no auto-create, no XML seed.
2. Project service likewise loads two project files; missing means `{}`.
3. Existing `models.json` / `auth.json` under the Agent directory are taken over by application service for load, watcher, revision, diagnostics, and later writes—no rewrite or move.
4. Sessions and `ChatWorkspaceState` are outside the config snapshot; this architecture does not touch them.
5. Files are first written on the user’s first UI save under the normal validate / lock / atomic-write protocol.

## Out of scope this round

- No Global / Project scope switch UI, inheritance source display, or restore-inheritance UI.
- Provider login uses the current project agent's `withControl`; reverse RPC and cancel stay as-is.
- No changes to Kotlin Host, SimpleRpc wire contracts, four-file format, revision algorithm, or atomic write protocol.
- No old XML migration, and no raw `authJson` for the UI.

## Verification scenarios

| Scenario | Expected result |
| --- | --- |
| First load | Application four files and project two files each read once; only settings / vibefly apply project-over-application |
| UI save | On matching revision, atomic write to target scope, invalidation only, other consumers re-fetch |
| External file change | After watcher debounce, snapshot and revision update; UI / Agent see new values without restart |
| Revision conflict | Host does not write; UI re-reads and semantically replays user edits up to four times |
| Invalid JSON | File stays as-is; runtime uses last valid snapshot with diagnostics; auto-recovers after fix |
| Application change | All project effective caches invalidate; all live Agents reload |
| Project change | Only that project’s UI / Agent invalidate and reload |
| models application-only | All projects share one `models.json`; `<project>/.vibefly/models.json` is never read |
| auth application-only | All projects share one `auth.json`; concurrent provider-level writes re-read and replay on conflict |
| UI secret isolation | Neither UI snapshots nor WebView logs contain raw credentials, API keys, or tokens |
| Agent live reload | Host-backed pi storage updates and live `AgentSession.reload()` runs at most once; process PID unchanged |
| Reconnect / missed notice | Consumers converge after first current-snapshot read; no dependency on historical event replay |

Doc and implementation wrap-up checks:

- All project paths must be `<project>/.vibefly/settings.json` or `<project>/.vibefly/settings.vibefly.json`, never `.pi/settings.json`.
- `models.json` and `auth.json` must appear only under the application directory—no project override or merge design.
- Raw `authJson` may travel only on the trusted Host ↔ Agent stdio control plane, never into any UI DTO.
- RPC service names must follow call direction: `Ui2Host`, `Host2Ui`, `Agent2Host`, `Host2Agent`.
- Merge order must be application first, project second.
- Agent stdout still carries only Content-Length protocol frames; reload logs go to stderr only.
- After contract changes, run the matching generate tasks and `generate:check`; for doc-only edits run `git diff --check`.
