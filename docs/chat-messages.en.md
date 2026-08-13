# pi messages → assistant-ui adapter

This document describes the **current** pipeline: how pi `AgentSessionEvent` becomes business-plane `ChatEvent`, then lands as `@assistant-ui/react` `ThreadMessage` via UI state. Runtime truth is the code.

Related: [architecture.en.md](./architecture.en.md), [rpc.en.md](./rpc.en.md), [agent.en.md](./agent.en.md).

中文版：[chat-messages.md](./chat-messages.md)

## 1. Three-stage pipeline

```text
pi AgentSession                    WS SimpleRpc                 WebView React
────────────────                   ────────────                 ─────────────
session.subscribe(AgentSessionEvent)
  │
  ▼  A. ChatSessionRegistry.#onSessionEvent
  │     pi event → ChatEvent (24ms batch per session)
  ▼  Agent2Ui.onChatEvents(ChatEventBatch)
  │──────────────────────────────────────────►  rpc/agent.ts
                                                   │
                                                   ▼  B. applyChatEvent (pure reducer)
                                                   │     ChatEvent → ChatTab.messages
                                                   ▼  C. convertChatMessage
                                                   │     ChatMessage → ThreadMessageLike
                                                   ▼  useExternalStoreRuntime + MessagePrimitive
                                                      MarkdownText / ReasoningPart / ToolPart / NoticePart
```

| Stage | Location | Core symbols | Output |
| --- | --- | --- | --- |
| **A. pi → wire DTO** | Agent `chatSessionRegistry.ts` | `#onSessionEvent`, `toChatMessages`, `#emit` / `#flushEvents` | `ChatEvent` / `ChatEventBatch` |
| **B. wire → UI state** | UI `chat/chatEventState.ts` | `applyChatEvent` | `ChatTab` (= `ChatSessionSnapshot`) |
| **C. UI → assistant-ui** | UI `chatMessageAdapter.ts` | `convertChatMessage` | `ThreadMessageLike` → `ThreadMessage` |

Contract types: `packages/vibefly-uiagent-shared/src/types.ts`.  
RPC: `Agent2Ui.onChatEvents` (`contracts.ts`; wire id from generated output).

## 2. Intermediate model (wire)

### 2.1 Messages and parts

```ts
// Summary; full definitions in uiagent-shared/src/types.ts
type ChatPart =
    | { kind: "text"; text: string }
    | { kind: "thinking"; text: string }
    | {
    kind: "tool"; toolCallId: string; name: string; status: ChatToolStatus
    input?: unknown; output?: string; isError?: boolean; locations?: ChatFileLocation[]
}
    | { kind: "notice"; level: "info" | "warning" | "error"; text: string }

type ChatMessage = {
    id: string
    role: "user" | "assistant" | "system"
    parts: ChatPart[]
    createdAt: number
    status: "streaming" | "complete" | "aborted" | "error"
}

type ChatToolStatus = "pending" | "running" | "completed" | "failed"
```

### 2.2 Streaming events

```ts
type ChatEvent =
    | { kind: "snapshot"; snapshot: ChatSessionSnapshot }
    | { kind: "summary"; summary: ChatSessionSummary }
    | { kind: "message"; sessionId: string; message: ChatMessage }
    | {
    kind: "partDelta"; sessionId: string; messageId: string
    partKind: "text" | "thinking"; delta: string
}
    | { kind: "messageStatus"; sessionId: string; messageId: string; status: ChatMessageStatus }
    | {
    kind: "tool"; sessionId: string; messageId: string
    part: Extract<ChatPart, { kind: "tool" }>
}
    | { kind: "queue"; turns: QueuedTurn[] }
    | {
    kind: "turnComplete"; sessionId: string; turnId: string
    ok: boolean; aborted?: boolean; error?: string
}
    | { kind: "sessionReleased"; sessionId: string }
    | { kind: "disconnected"; message: string }

type ChatEventBatch = { sessionId: string; sequence: number; events: ChatEvent[] }
```

**Interactions that do not enter message parts** (side-channel RPC): `requestToolPermission`, `requestUserInput`.  
Session-level metadata uses `summary` (state, `queuePosition`, model, thinking level, etc.).

## 3. Stage A: pi → ChatEvent

Entry: `#onSessionEvent` in `packages/vibefly-agent/src/chatSessionRegistry.ts`.

### 3.1 Event mapping

| pi `AgentSessionEvent` | Emitted `ChatEvent` | Notes |
| --- | --- | --- |
| `agent_start` | `message` (empty assistant, `status: "streaming"`) | Assigns `activeMessageId`; **one** assistant message per full agent run |
| `message_update` + `text_delta` | `partDelta{partKind:"text"}` | |
| `message_update` + `thinking_delta` | `partDelta{partKind:"thinking"}` | |
| `message_update` other (`*_start`/`*_end`/`toolcall_*`/`done`/`error`) | *dropped* | Tool args are not streamed to UI |
| `tool_execution_start` | `tool`, `status: "running"` | `input = args`; `locations` derived from path-like args |
| `tool_execution_update` | *dropped* | No partial tool output |
| `tool_execution_end` | `tool`, `completed` / `failed` | `output = safeJson(result)` |
| `message_end` (assistant) | `messageStatus` | May fire multiple times within one run |
| `agent_end` | *only clears* `activeMessageId` | |
| `thinking_level_changed` | `summary` | |
| `turn_*` / `message_start` / compaction / retry / queue etc. | *dropped* | |

Batching: `EVENT_BATCH_WINDOW_MS = 24`, then `Agent2Ui.onChatEvents` per session. Delivery failures log at debug only — **no retry, no sequence gap detection**.

### 3.2 Non-subscribe sources

| Source | Events |
| --- | --- |
| `sendChatMessage` | Synthetic user `message` + `summary` + `queue` |
| `createChatSession` / `openChatSession` | `snapshot` (history via `toChatMessages`) |
| `releaseChatSession` | `sessionReleased` |
| `#drainQueue` finally | `turnComplete` + `summary` |
| Permission / input wait | `summary` (`waiting_permission` / `waiting_input`) |
| extension `notify()` | `message`, `role: "system"`, parts are `notice` |
| *no producer* | `disconnected` (UI has a handler; nothing emits today) |

### 3.3 History replay `toChatMessages`

- Walk `session.messages`.
- Fold `toolResult` into the matching `toolCallId` tool part of the previous message (`output`, `status`).
- Keep `user` / `assistant`; map `developer` → wire `role: "system"`.
- Content blocks: `text` → `text`, `thinking` → `thinking`, `toolCall` → `tool` (history always `status: "completed"`, **no locations**).
- id: `String(message.id ?? "history-<idx>")`; status mapped from pi `stopReason` / `errorMessage`.

### 3.4 Streaming semantics (what the screen does)

1. `agent_start` → empty streaming assistant + streaming caret.
2. text / thinking deltas append into **their single** part each (see stage B).
3. `tool_execution_start` appends a tool-call (args already complete, not streamed).
4. `tool_execution_end` merges output; finished `edit` / `write` triggers host file refresh.
5. One agent run (multi LLM rounds + multi tools) **collapses into one** `ChatMessage`: at most 1 text, 1 thinking, N tools.

## 4. Stage B: ChatEvent → UI state

Entry: `applyChatEvent` in `packages/vibefly-ui/src/chat/chatEventState.ts`.  
Consumer: `useChatController.applyBatch` (`batch.sequence` is not validated today).

| `kind` | Behavior |
| --- | --- |
| `snapshot` | Replace or append tab by sessionId |
| `summary` | Merge `tab.summary`; active session forces `unread: false` |
| `message` | Upsert by `message.id` (same id replaces whole message) |
| `partDelta` | Self-heal: create streaming assistant if unknown id; append delta to the **first** part of same `partKind`, else push new part |
| `messageStatus` | Write `message.status` |
| `tool` | Merge by `toolCallId`; finished `edit`/`write` → `effects.refreshPaths` |
| `turnComplete` | Update session state / unread; non-abort error → banner |
| `sessionReleased` | Delete tab |
| `disconnected` | `effects.error` |
| `queue` | **no-op** (queue position only via `summary.queuePosition`) |

## 5. Stage C: ChatMessage → assistant-ui

Entry: `convertChatMessage` in `packages/vibefly-ui/src/chatMessageAdapter.ts`.  
Runtime: `AssistantChat` uses `useExternalStoreRuntime<ChatMessage>({ convertMessage: convertChatMessage, ... })`.

### 5.1 Part mapping

| `ChatPart` / field | assistant-ui | Render component |
| --- | --- | --- |
| `text` | `{ type: "text", text }` | `MarkdownText` (Streamdown) |
| `thinking` | `{ type: "reasoning", text }` | `ReasoningPart` |
| `tool` | `{ type: "tool-call", toolCallId, toolName, argsText, artifact, result?, isError }` | `ToolPart` (`tools.Fallback`) |
| `notice` | `{ type: "data", name: "vibefly-notice", data: { level, text } }` | `NoticePart` |
| `role: "user"` | `role: "user"`, **no** status | plain text, no markdown |
| `role: "assistant"` | `role: "assistant"` + status | assistant parts |
| `role: "system"` | **forced to `assistant`** | otherwise `fromThreadMessageLike` requires system to have a single text part |
| `status: streaming` | `{ type: "running" }` | `.streaming-caret` |
| `status: complete` | `{ type: "complete", reason: "stop" }` | |
| `status: aborted` | `{ type: "incomplete", reason: "cancelled" }` | no dedicated UI yet |
| `status: error` | `{ type: "incomplete", reason: "error" }` | Retry button (no onClick today) |
| tool `pending`/`running` | no `result` | spinner |
| tool `completed`/`failed` | `result: output ?? null`; `isError` when failed | check / bang |

**Side-channel `artifact`** (native assistant-ui tool-call has none of these):

```ts
type ToolArtifact = {
    status: ChatToolStatus
    output?: string
    locations?: ChatFileLocation[]
}
```

`ToolPart` reads `artifact.status`; `locations[0]` can open a file; `edit`/`write` can open Diff.

### 5.2 Adapter constraints (from assistant-ui)

1. **status is assistant-only** — user must not carry status.
2. **system allows only a single text** — wire system notices render as assistant + `data` part.
3. **Empty text / reasoning is dropped** — blank-only thinking leaves mostly the caret.
4. Tools use **`argsText` not `args`**, for assistant-ui partial JSON parsing; `safeStringify` failure falls back to `"{}"`.
5. **Message component refs must be module-stable** (`threadMessageComponents`); never inline `Message: () => ...` in render, or every streaming tick remounts the tree and loses tool expand state / tables.

### 5.3 Runtime capability boundary

`useExternalStoreRuntime` only wires `onNew` / `onCancel`:

- **No** edit, branch, regenerate, or client-side tool invocation.
- Tools always run inside pi; native assistant-ui `approval` / `onRespondToToolApproval` are **unused**.
- `isRunning` comes from session summary (`busy` / `queued`), not single message.status.
- Each tab has `key={sessionId}` with an independent runtime; open tab count is uncapped.

## 6. Side-channel interactions (not message parts)

### Tool approval

- `createPathGuardExtension`: path escape is blocked immediately; `bash` / `edit` / `write` go through `Agent2Ui.requestToolPermission` (long timeout).
- UI: `PermissionCard` draws inside the viewport, **outside** the thread; background sessions use the attention bar.
- pi emits `tool_execution_start` **before** `beforeToolCall`, so while waiting for approval the tool row is already `running`; reject → `tool_execution_end` + `isError` → `failed`.

### User input

- extension UI → `requestUserInput` (select / confirm / input); state `waiting_input`.
- `notify()` is the only extension UI method that injects chat messages.

### Cancel

- `abortChatTurn` → `session.abort()`; if only queued, degrades to `cancelQueuedTurn`.
- Abort detection is string-heuristic on errors (`/abort|stopped|interrupt/i`), affecting `turnComplete` and session state.

## 7. Key files

| Path | Symbols |
| --- | --- |
| `vibefly-uiagent-shared/src/types.ts` | `ChatPart`, `ChatMessage`, `ChatEvent`, `ChatEventBatch` |
| `vibefly-uiagent-shared/src/contracts.ts` | `Ui2Agent`, `Agent2Ui` |
| `vibefly-agent/src/chatSessionRegistry.ts` | `#onSessionEvent`, `toChatMessages`, `messageParts`, `#emit` / `#flushEvents`, permission / extension UI |
| `vibefly-agent/src/chatScheduler.ts` | `SerialTurnScheduler` |
| `vibefly-ui/src/chat/chatEventState.ts` | `applyChatEvent` |
| `vibefly-ui/src/chatMessageAdapter.ts` | `convertChatMessage`, `ToolArtifact` |
| `vibefly-ui/src/chat/useChatController.ts` | `applyBatch`, `sendMessage`, `stopOrCancel`, permission / input resolve |
| `vibefly-ui/src/chat/AssistantChat.tsx` | `useExternalStoreRuntime`, `PermissionCard`, `InputCard` |
| `vibefly-ui/src/chat/MessageParts.tsx` | `ChatMessageView`, `MarkdownText`, `ReasoningPart`, `ToolPart`, `NoticePart` |
| `vibefly-ui/src/chatMessageAdapter.test.ts` | mapping unit tests (authoritative) |
| `vibefly-ui/src/chat/chatEventState.test.ts` | reducer unit tests |

Styles: `packages/vibefly-ui/src/styles/messages.css` (`.streaming-caret`, `.tool-part`, `.thinking-block`, `.notice-part`, etc.).  
i18n: `public/locales/{en,zh}/chat.json`.

## 8. Invariants & known gaps

**Invariants**

1. One agent run ↔ one streaming/complete assistant `ChatMessage` (multi LLM rounds and tools fold into parts).
2. At most one `text` part and one `thinking` part per run (`partDelta` always merges into the first same kind).
3. Tool status / paths / raw output live on `artifact`, not native assistant-ui fields.
4. Permission and user input never enter the thread message; they use dedicated RPC + cards.

**Known behavior / gaps (watch when changing code)**

| Item | Notes |
| --- | --- |
| Text order after tools | deltas still append to the **earlier** text part, so text may appear **above** tools visually |
| Mid-run `messageStatus: complete` | intermediate `message_end` (e.g. `stopReason: "toolUse"`) turns off the caret while thread `isRunning` still follows summary |
| History drops metadata | reopened sessions lack tool `locations` / Diff; interrupted tools may show completed |
| `queue` event | reducer no-op |
| `disconnected` | no producer; disconnect relies on peer polling / reconnect in `rpc/agent.ts` |
| `batch.sequence` | no gap detection / resync |
| `notify` shares active message id | notify during stream may **overwrite** the current assistant message |
| abort visuals | `cancelled` has no dedicated style; error Retry is unwired |
| Single Agent, single WS | a second WebView replaces the previous connection |

## 9. When changing this

1. Change wire shape → `uiagent-shared` types + contracts → `pnpm --filter @vibefly/uiagent-shared run generate`.
2. Change pi mapping → `chatSessionRegistry.ts` (stage A); UI merge → `chatEventState.ts` (stage B); assistant-ui shape → `chatMessageAdapter.ts` + `MessageParts.tsx` (stage C).
3. Keep this page and tests in sync: `chatMessageAdapter.test.ts`, `chatEventState.test.ts`.
4. Do not mirror UI↔Agent contracts into Kotlin; do not modify upstream pi source.
