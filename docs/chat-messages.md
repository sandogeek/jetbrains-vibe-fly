# pi 消息 → assistant-ui 适配

本文描述 **现状**：pi `AgentSessionEvent` 如何变成业务面 `ChatEvent`，再经 UI 状态落到
`@assistant-ui/react` 的 `ThreadMessage`。运行时真相以代码为准。

相关文档：[architecture.md](./architecture.md)、[rpc.md](./rpc.md)、[agent.md](./agent.md)。

English: [chat-messages.en.md](./chat-messages.en.md)

## 1. 三阶段流水线

```text
pi AgentSession                    WS SimpleRpc                 WebView React
────────────────                   ────────────                 ─────────────
session.subscribe(AgentSessionEvent)
  │
  ▼  A. ChatSessionRegistry.#onSessionEvent
  │     pi event → ChatEvent（按会话 24ms 批）
  ▼  Agent2Ui.onChatEvents(ChatEventBatch)
  │──────────────────────────────────────────►  rpc/agent.ts
                                                   │
                                                   ▼  B. applyChatEvent（纯 reducer）
                                                   │     ChatEvent → ChatTab.messages
                                                   ▼  C. convertChatMessage
                                                   │     ChatMessage → ThreadMessageLike
                                                   ▼  useExternalStoreRuntime + MessagePrimitive
                                                      MarkdownText / GroupedParts reasoning 面板 / ToolTimeline + ToolRow / NoticePart
```

| 阶段                     | 位置                           | 核心符号                                                      | 产出                                  |
|--------------------------|--------------------------------|---------------------------------------------------------------|---------------------------------------|
| **A. pi → wire DTO**     | Agent `chatSessionRegistry.ts` | `#onSessionEvent`、`toChatMessages`、`#emit` / `#flushEvents` | `ChatEvent` / `ChatEventBatch`        |
| **B. wire → UI 状态**    | UI `chat/chatEventState.ts`    | `applyChatEvent`                                              | `ChatTab`（=`ChatSessionSnapshot`）   |
| **C. UI → assistant-ui** | UI `chatMessageAdapter.ts`     | `convertChatMessage`                                          | `ThreadMessageLike` → `ThreadMessage` |

契约类型：`packages/vibefly-uiagent-shared/src/types.ts`。  
RPC：`Agent2Ui.onChatEvents`（`contracts.ts`，wire id 以生成物为准）。

## 2. 中间模型（wire）

### 2.1 消息与部件

```ts
// 摘要；完整定义见 uiagent-shared/src/types.ts
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

### 2.2 流式事件

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

**不进消息 parts 的交互**（旁路 RPC）：`requestToolPermission`、`requestUserInput`。  
会话级元数据走 `summary`（状态、`queuePosition`、模型、thinking level 等）。

## 3. 阶段 A：pi → ChatEvent

入口：`packages/vibefly-agent/src/chatSessionRegistry.ts` 的 `#onSessionEvent`。

### 3.1 事件映射

| pi `AgentSessionEvent`                                                 | 发出的 `ChatEvent`                               | 说明                                                           |
|------------------------------------------------------------------------|--------------------------------------------------|----------------------------------------------------------------|
| `agent_start`                                                          | `message`（空 assistant，`status: "streaming"`） | 分配 `activeMessageId`；**整次 agent run 一条** assistant 消息 |
| `message_update` + `text_delta`                                        | `partDelta{partKind:"text"}`                     |                                                                |
| `message_update` + `thinking_delta`                                    | `partDelta{partKind:"thinking"}`                 |                                                                |
| `message_update` 其它（`*_start`/`*_end`/`toolcall_*`/`done`/`error`） | *丢弃*                                           | 工具参数不流式推 UI                                            |
| `tool_execution_start`                                                 | `tool`，`status: "running"`                      | `input = args`；`locations` 从 path 类参数推导                 |
| `tool_execution_update`                                                | `tool`，`status: "running"`                      | `output` **全量覆盖**（pi bash 100ms 截断尾快照，不拼接）；不带 input/locations |
| `tool_execution_end`                                                   | `tool`，`completed` / `failed`                   | `output = toolResultText(result)`（结构化 `{content,details}` 收成文本） |
| `message_end`（assistant）                                             | `messageStatus`                                  | 一次 run 内可能多次                                            |
| `agent_end`                                                            | *仅清* `activeMessageId`                         |                                                                |
| `thinking_level_changed`                                               | `summary`                                        |                                                                |
| `turn_*` / `message_start` / compaction / retry / queue 等             | *丢弃*                                           |                                                                |

批处理：`EVENT_BATCH_WINDOW_MS = 24`，按会话攒批后 `Agent2Ui.onChatEvents`。投递失败仅 debug 日志， **无重试、无 sequence
缺口检测**。

### 3.2 非 subscribe 来源

| 来源                                    | 事件                                                |
|-----------------------------------------|-----------------------------------------------------|
| `sendChatMessage`                       | 合成 user `message` + `summary` + `queue`           |
| `createChatSession` / `openChatSession` | `snapshot`（历史经 `toChatMessages`）               |
| `releaseChatSession`                    | `sessionReleased`                                   |
| `#drainQueue` finally                   | `turnComplete` + `summary`                          |
| 权限 / 输入等待                         | `summary`（`waiting_permission` / `waiting_input`） |
| extension `notify()`                    | `message`，`role: "system"`，parts 为 `notice`      |
| *无生产者*                              | `disconnected`（UI 有处理分支，当前无发射点）       |

### 3.3 历史回放 `toChatMessages`

- 遍历 `session.messages`。
- `toolResult` **折叠**进前一条消息里对应 `toolCallId` 的 tool part（`output`、`status`）。
- `user` / `assistant` 原样；`developer` → wire `role: "system"`。
- content 块：`text` → `text`，`thinking` → `thinking`，`toolCall` → `tool`（历史一律 `status: "completed"`；`locations` 从 arguments 重算，read 填 `line`）。
- id：`String(message.id ?? "history-<idx>")`；status 由 pi `stopReason` / `errorMessage` 映射。

### 3.4 流式语义（屏幕上实际发生什么）

1. `agent_start` → 空 streaming assistant + 流式光标。
2. text / thinking delta 拼进 **各自唯一**的 part（见阶段 B）。
3. `tool_execution_start` 追加 tool-call（args 已完整，不流式）。
4. `tool_execution_end` 合并 output；`edit` / `write` 完成会触发宿主刷新文件。
5. 一次 agent run（多轮 LLM + 多工具） **折叠为一条** `ChatMessage`：至多 1 个 text、1 个 thinking、N 个 tool。

## 4. 阶段 B：ChatEvent → UI 状态

入口：`packages/vibefly-ui/src/chat/chatEventState.ts` 的 `applyChatEvent`。  
消费：`useChatController.applyBatch`（`batch.sequence` 目前未校验）。

| `kind`            | 行为                                                                                                    |
|-------------------|---------------------------------------------------------------------------------------------------------|
| `snapshot`        | 按 sessionId 替换或追加 tab                                                                             |
| `summary`         | 合并 `tab.summary`；活跃会话强制 `unread: false`                                                        |
| `message`         | 按 `message.id` upsert（同 id 整条替换）                                                                |
| `partDelta`       | 未知 id 则自愈创建 streaming assistant；对**第一个**同 `partKind` 的 part 追加 delta，否则 push 新 part |
| `messageStatus`   | 写 `message.status`                                                                                     |
| `tool`            | 按 `toolCallId` merge；`edit`/`write` 完成 → `effects.refreshPaths`                                     |
| `turnComplete`    | 更新 session state / unread；非 abort 的 error → 横幅                                                   |
| `sessionReleased` | 删 tab                                                                                                  |
| `disconnected`    | `effects.error`                                                                                         |
| `queue`           | **no-op**（队列位置只靠 `summary.queuePosition`）                                                       |

## 5. 阶段 C：ChatMessage → assistant-ui

入口：`packages/vibefly-ui/src/chatMessageAdapter.ts` 的 `convertChatMessage`。  
Runtime：`AssistantChat` 使用 `useExternalStoreRuntime<ChatMessage>({ convertMessage: convertChatMessage, ... })`。

### 5.1 部件映射

| `ChatPart` / 字段         | assistant-ui                                                                        | 渲染组件                                                      |
|---------------------------|-------------------------------------------------------------------------------------|---------------------------------------------------------------|
| `text`                    | `{ type: "text", text }`                                                            | `MarkdownText`（Streamdown）                                  |
| `thinking`                | `{ type: "reasoning", text }`                                                       | 官方 reasoning 面板（`GroupedParts` + Streamdown）            |
| `tool`                    | `{ type: "tool-call", toolCallId, toolName, argsText, artifact, result?, isError }` | 连续 2+ 个走 `GroupedParts` `group-tool` → `ToolTimeline` 摘要，展开后仍是 `ToolRow`（ReadBlock / DiffBlock / TerminalBlock / SearchBlock / generic）；单个 tool-call 直接 `ToolRow` |
| `notice`                  | `{ type: "data", name: "vibefly-notice", data: { level, text } }`                   | `NoticePart`                                                  |
| `role: "user"`            | `role: "user"`，**无** status                                                       | 纯文本，不走 markdown                                         |
| `role: "assistant"`       | `role: "assistant"` + status                                                        | assistant parts                                               |
| `role: "system"`          | **强制改为 `assistant`**                                                            | 否则 `fromThreadMessageLike` 要求 system 只能有一个 text part |
| `status: streaming`       | `{ type: "running" }`                                                               | `.streaming-caret`                                            |
| `status: complete`        | `{ type: "complete", reason: "stop" }`                                              |                                                               |
| `status: aborted`         | `{ type: "incomplete", reason: "cancelled" }`                                       | 暂无专门 UI                                                   |
| `status: error`           | `{ type: "incomplete", reason: "error" }`                                           | Retry 按钮（当前无 onClick）                                  |
| tool `pending`/`running`  | 不设 `result`                                                                       | 行上扫光（running）                                           |
| tool `completed`/`failed` | `result: output ?? null`；failed 时 `isError`                                       | 工具图标 / 红色状态点                                         |

**侧信道 `artifact`**（assistant-ui 原生 tool-call 无这些字段）：

```ts
type ToolArtifact = {
    status: ChatToolStatus
    output?: string
    locations?: ChatFileLocation[]
}
```

`ToolRow` 从 `artifact` + `argsText` 纯函数推导卡片：`read` → ReadBlock（行号 gutter + shiki），`write`/`edit` → DiffBlock，`bash` → 官方 TerminalBlock + ANSI 适配（running 可流式），`grep`/`find`/`ls` → SearchBlock，其余 generic。路径可点开文件。

### 5.2 适配约束（来自 assistant-ui）

1. **status 仅允许 assistant** — user 不得带 status。
2. **system 只能单 text** — wire 上的 system notice 渲染时改成 assistant + `data` part。
3. **空 text / reasoning 会被丢弃** — 仅空白 thinking 时几乎只剩光标。
4. 工具用 **`argsText` 而非 `args`**，交给 assistant-ui 的 partial JSON 解析；`safeStringify` 失败回退 `"{}"`。
5. **Message 组件引用必须模块级稳定**（`threadMessageComponents`），禁止在 render 里内联 `Message: () => ...`，否则流式每
   tick 整树 remount，工具展开态与表格会丢。

### 5.3 Runtime 能力边界

`useExternalStoreRuntime` 只接了 `onNew` / `onCancel`：

- **无** 编辑、分支、重新生成、客户端 tool invocation。
- 工具全部在 pi 内执行；assistant-ui 原生 `approval` / `onRespondToToolApproval` **未使用**。
- `isRunning` 来自会话 summary（`busy` / `queued`），不是单条 message.status。
- 每 tab `key={sessionId}` 独立 runtime；打开数量不设上限。

## 6. 旁路交互（非 message parts）

### 工具审批

- `createPathGuardExtension`：路径逃逸直接 block；`bash` / `edit` / `write` 走 `Agent2Ui.requestToolPermission`（长超时）。
- UI：`PermissionCard` 画在 viewport 内、 **thread 外**；后台会话用 attention bar。
- pi 在 `beforeToolCall` **之前**会发 `tool_execution_start`，故审批等待时 tool 行已是 `running`；拒绝 →
  `tool_execution_end` + `isError` → `failed`。

### 用户输入

- extension UI → `requestUserInput`（select / confirm / input）；state `waiting_input`。
- `notify()` 是唯一会注入聊天消息的 extension UI 方法。

### 取消

- `abortChatTurn` → `session.abort()`；仅排队则退化为 `cancelQueuedTurn`。
- abort 判定是错误字符串启发式（`/abort|stopped|interrupt/i`），影响 `turnComplete` 与 session state。

## 7. 关键文件

| 路径                                         | 符号                                                                                               |
|----------------------------------------------|----------------------------------------------------------------------------------------------------|
| `vibefly-uiagent-shared/src/types.ts`        | `ChatPart`、`ChatMessage`、`ChatEvent`、`ChatEventBatch`                                           |
| `vibefly-uiagent-shared/src/contracts.ts`    | `Ui2Agent`、`Agent2Ui`                                                                             |
| `vibefly-agent/src/chatSessionRegistry.ts`   | `#onSessionEvent`、`toChatMessages`、`messageParts`、`#emit` / `#flushEvents`、权限 / extension UI |
| `vibefly-agent/src/chatScheduler.ts`         | `SerialTurnScheduler`                                                                              |
| `vibefly-ui/src/chat/chatEventState.ts`      | `applyChatEvent`                                                                                   |
| `vibefly-ui/src/chatMessageAdapter.ts`       | `convertChatMessage`、`ToolArtifact`                                                               |
| `vibefly-ui/src/chat/useChatController.ts`   | `applyBatch`、`sendMessage`、`stopOrCancel`、权限 / 输入 resolve                                   |
| `vibefly-ui/src/chat/AssistantChat.tsx`      | `useExternalStoreRuntime`、`PermissionCard`、`InputCard`                                           |
| `vibefly-ui/src/chat/MessageParts.tsx`       | `ChatMessageView`、`AssistantMessageParts`、`MarkdownText`、`NoticePart`                            |
| `vibefly-ui/src/chat/tools/ToolTimelineGroup.tsx` | 连续 tool-call 的 `ToolTimeline` 摘要壳（单工具不套）                                        |
| `vibefly-ui/src/chat/tools/toolTimelineModel.ts` | verb / chip / 文件 +/- 统计                                                                     |
| `vibefly-ui/src/components/elements/`        | 官方 elements：`tool-timeline`、`terminal-block`、`surfaces`、`range`（Radix + JCEF shimmer）  |
| `vibefly-ui/src/components/assistant-ui/reasoning.tsx` | 官方 reasoning 面板（`ReasoningRoot` / `Trigger` / `Content` / `Text`）                    |
| `vibefly-ui/src/chat/tools/`                 | `ToolPart`、`ToolRow`、`ReadBlock`、`DiffBlock`、`TerminalBlock`、`SearchBlock`、presenters         |
| `vibefly-ui/src/chatMessageAdapter.test.ts`  | 映射单测（权威）                                                                                   |
| `vibefly-ui/src/chat/chatEventState.test.ts` | reducer 单测                                                                                       |

样式：`packages/vibefly-ui/src/styles/messages.css`（`.streaming-caret`、`.tool-part`、`.reasoning-markdown`、`.notice-part`
等）。  
i18n：`public/locales/{en,zh}/chat.json`。

## 8. 不变量与已知缺口

**不变量**

1. 一次 agent run ↔ 一条 streaming/complete assistant `ChatMessage`（多 LLM 轮次与工具折叠在 parts 里）。
2. 每个 run 至多一个 `text` part、一个 `thinking` part（`partDelta` 总是 merge 到第一个同 kind）。
3. 工具状态 / 路径 / 原始 output 走 `artifact`，不塞进 assistant-ui 原生字段。
4. 权限与用户输入不进 thread message，走独立 RPC + 卡片。

**已知行为 / 缺口（改代码时注意）**

| 项                             | 说明                                                                                              |
|--------------------------------|---------------------------------------------------------------------------------------------------|
| 工具后文本顺序                 | delta 仍 append 到**先前**的 text part，视觉上可能出现在 tool **上方**                            |
| 中途 `messageStatus: complete` | 中间 `message_end`（如 `stopReason: "toolUse"`）会关光标，但 thread `isRunning` 仍由 summary 维持 |
| 中断工具状态                   | 历史回放里中断的工具也可能显示 completed（无独立 aborted 态）                                     |
| `queue` 事件                   | reducer no-op                                                                                     |
| `disconnected`                 | 无生产者；断线靠 `rpc/agent.ts` 的 peer 轮询与重连                                                |
| `batch.sequence`               | 未做缺口检测 / 重同步                                                                             |
| `notify` 与 active 消息同 id   | 流式中 notify 可能 **覆盖** 当前 assistant 消息                                                   |
| abort 视觉                     | `cancelled` 无专门样式；error 的 Retry 未接线                                                     |
| 单 Agent 单 WS                 | 第二个 WebView 会 replace 前一个连接                                                              |

## 9. 改这里时

1. 改 wire 形状 → `uiagent-shared` types + contracts → `pnpm --filter @vibefly/uiagent-shared run generate`。
2. 改 pi 映射 → `chatSessionRegistry.ts`（阶段 A）；改 UI 合并 → `chatEventState.ts`（阶段 B）；改 assistant-ui 形态 →
   `chatMessageAdapter.ts` + `MessageParts.tsx`（阶段 C）。
3. 同步更新本页与对应单测：`chatMessageAdapter.test.ts`、`chatEventState.test.ts`、`chat/tools/present*.test.ts`、`chat/tools/toolTimelineModel.test.ts`。
4. 不要把 UI↔Agent 契约镜像到 Kotlin；不要改上游 pi 源码。
