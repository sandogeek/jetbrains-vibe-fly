import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {afterEach, describe, test} from "node:test"
import {expect} from "expect"
import type {Agent2Ui, ChatEventBatch} from "@vibefly/uiagent-shared"
import {ChatSessionRegistry} from "./chatSessionRegistry.js"
import {mapSessionEvent, toChatMessages} from "./chat/eventMapper.js"
import {modelKey, resolveModel, toModelOption} from "./chat/modelResolution.js"
import {formatPrompt, firstLine} from "./chat/sessionLifecycle.js"

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, {recursive: true, force: true})
})

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibefly-registry-"))
  tempDirs.push(root)
  return fs.realpathSync(root)
}

function collectSink() {
  const batches: ChatEventBatch[] = []
  const sink = {
    onChatEvents: async (batch: ChatEventBatch) => {
      batches.push(batch)
    },
    requestToolPermission: async () => ({requestId: "", decision: "cancelled" as const}),
    requestUserInput: async () => ({requestId: "", cancelled: true as const}),
  } as unknown as Agent2Ui
  return {sink, batches}
}

async function flushEvents(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 40))
}

describe("ChatSessionRegistry main paths", () => {
  test("binds to a project root and lists empty sessions", async () => {
    const projectRoot = makeProject()
    const registry = new ChatSessionRegistry(projectRoot)
    const sessions = await registry.listChatSessions({projectRoot})
    expect(sessions).toEqual([])
    await expect(registry.listChatSessions({projectRoot: makeProject()})).rejects.toThrow(
      /already bound to project/,
    )
    await registry.dispose()
  })

  test("sendChatMessage rejects unknown sessions and empty text", async () => {
    const projectRoot = makeProject()
    const registry = new ChatSessionRegistry()
    registry.__testInsertSession({sessionId: "s1", projectRoot})
    expect(() =>
      registry.sendChatMessage({
        sessionId: "missing",
        text: "hi",
        clientMessageId: "c1",
      }),
    ).toThrow(/not open/)
    expect(() =>
      registry.sendChatMessage({
        sessionId: "s1",
        text: "   ",
        clientMessageId: "c2",
      }),
    ).toThrow(/empty/)
    await registry.dispose()
  })

  test("sendChatMessage dedupes clientMessageId and emits user message", async () => {
    const projectRoot = makeProject()
    const registry = new ChatSessionRegistry()
    const {sink, batches} = collectSink()
    registry.attach(sink)
    registry.__testInsertSession({sessionId: "s1", projectRoot, title: "New session"})

    const first = registry.sendChatMessage({
      sessionId: "s1",
      text: "hello world",
      clientMessageId: "client-1",
    })
    const second = registry.sendChatMessage({
      sessionId: "s1",
      text: "hello world",
      clientMessageId: "client-1",
    })
    expect(second).toEqual(first)
    expect(first.state).toBe("running")

    await flushEvents()
    const events = batches.flatMap((batch) => batch.events)
    expect(events.some((event) => event.kind === "message")).toBe(true)
    expect(events.some((event) => event.kind === "summary")).toBe(true)

    // turn fails without runtime file; still completes the queue path
    await new Promise((resolve) => setTimeout(resolve, 50))
    const summary = registry.__testGetSummary("s1")
    expect(summary?.unread).toBe(true)
    expect(summary?.state).toBe("error")
    expect(
      batches.some((batch) => batch.events.some((event) => event.kind === "turnComplete")),
    ).toBe(true)

    await registry.dispose()
  })

  test("retryChatTurn rejects unknown sessions and running turns", async () => {
    const projectRoot = makeProject()
    const registry = new ChatSessionRegistry()
    registry.__testInsertSession({sessionId: "s1", projectRoot})
    expect(() => registry.retryChatTurn("missing")).toThrow(/not open/)

    registry.sendChatMessage({
      sessionId: "s1",
      text: "hello",
      clientMessageId: "c1",
    })
    expect(() => registry.retryChatTurn("s1")).toThrow(/Wait for the current turn/)
    await registry.dispose()
  })

  test("retryChatTurn does not emit another user message", async () => {
    const projectRoot = makeProject()
    const registry = new ChatSessionRegistry()
    const {sink, batches} = collectSink()
    registry.attach(sink)
    registry.__testInsertSession({sessionId: "s1", projectRoot, title: "New session"})

    registry.sendChatMessage({
      sessionId: "s1",
      text: "hello world",
      clientMessageId: "client-1",
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(registry.__testGetSummary("s1")?.state).toBe("error")

    const userMessagesBefore = batches
      .flatMap((batch) => batch.events)
      .filter((event) => event.kind === "message" && event.message.role === "user")
    expect(userMessagesBefore).toHaveLength(1)

    const retried = registry.retryChatTurn("s1")
    expect(retried.state).toBe("running")
    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushEvents()

    const userMessagesAfter = batches
      .flatMap((batch) => batch.events)
      .filter((event) => event.kind === "message" && event.message.role === "user")
    expect(userMessagesAfter).toHaveLength(1)
    expect(
      batches.filter((batch) => batch.events.some((event) => event.kind === "turnComplete")).length,
    ).toBeGreaterThanOrEqual(2)

    await registry.dispose()
  })

  test("cancelQueuedTurn clears queued state for non-active session", async () => {
    const projectRoot = makeProject()
    const registry = new ChatSessionRegistry()
    const {sink, batches} = collectSink()
    registry.attach(sink)
    registry.__testInsertSession({sessionId: "s1", projectRoot})
    registry.__testInsertSession({sessionId: "s2", projectRoot})

    // Start s1 so s2 becomes queued
    registry.sendChatMessage({
      sessionId: "s1",
      text: "first",
      clientMessageId: "a",
    })
    const queued = registry.sendChatMessage({
      sessionId: "s2",
      text: "second",
      clientMessageId: "b",
    })
    expect(queued.state).toBe("queued")
    expect(registry.__testGetSummary("s2")?.state).toBe("queued")

    registry.cancelQueuedTurn("s2")
    expect(registry.__testGetSummary("s2")?.state).toBe("idle")
    expect(registry.__testGetSummary("s2")?.queuePosition).toBeUndefined()

    await flushEvents()
    expect(batches.some((batch) => batch.events.some((event) => event.kind === "queue"))).toBe(true)
    await registry.dispose()
  })

  test("releaseChatSession removes open session and emits sessionReleased", async () => {
    const projectRoot = makeProject()
    const registry = new ChatSessionRegistry()
    const {sink, batches} = collectSink()
    registry.attach(sink)
    registry.__testInsertSession({sessionId: "s1", projectRoot})

    await registry.releaseChatSession("s1")
    await flushEvents()
    expect(registry.__testGetSummary("s1")).toBeUndefined()
    expect(
      batches.some((batch) =>
        batch.events.some((event) => event.kind === "sessionReleased" && event.sessionId === "s1"),
      ),
    ).toBe(true)
    await registry.dispose()
  })

  test("rejects model and thinking changes while a turn is active", async () => {
    const projectRoot = makeProject()
    const registry = new ChatSessionRegistry()
    registry.__testInsertSession({sessionId: "s1", projectRoot})
    registry.sendChatMessage({
      sessionId: "s1",
      text: "run",
      clientMessageId: "run-1",
    })
    // Start both while the turn is still marked running/active.
    const modelPromise = registry.setChatModel("s1", "x/y")
    const thinkingPromise = registry.setChatThinkingLevel("s1", "high")
    await expect(modelPromise).rejects.toThrow(/cannot change while/)
    await expect(thinkingPromise).rejects.toThrow(/cannot change while/)
    await new Promise((resolve) => setTimeout(resolve, 30))
    registry.markChatSessionRead("s1")
    expect(registry.__testGetSummary("s1")?.unread).toBe(false)
    await registry.dispose()
  })

  test("disconnect aborts active sink and resets queued summaries", async () => {
    const projectRoot = makeProject()
    const registry = new ChatSessionRegistry()
    const {sink} = collectSink()
    registry.attach(sink)
    registry.__testInsertSession({sessionId: "s1", projectRoot})
    registry.__testInsertSession({sessionId: "s2", projectRoot})
    registry.sendChatMessage({sessionId: "s1", text: "one", clientMessageId: "1"})
    registry.sendChatMessage({sessionId: "s2", text: "two", clientMessageId: "2"})
    expect(registry.__testGetSummary("s2")?.state).toBe("queued")
    await registry.disconnect()
    expect(registry.__testGetSummary("s2")?.state).toBe("idle")
    await registry.dispose()
  })
})

describe("chat eventMapper / modelResolution helpers", () => {
  test("toChatMessages merges tool results into tool parts", () => {
    const messages = toChatMessages([
      {
        role: "assistant",
        id: "a1",
        timestamp: 1,
        content: [
          {type: "text", text: "hi"},
          {type: "toolCall", id: "t1", name: "read", arguments: {path: "a.ts"}},
        ],
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        content: "file body",
        isError: false,
      },
    ] as never)
    expect(messages).toHaveLength(1)
    const tool = messages[0]!.parts.find((part) => part.kind === "tool")
    expect(tool).toMatchObject({toolCallId: "t1", output: "file body", status: "completed"})
  })

  test("mapSessionEvent maps agent_start and text deltas", () => {
    const state = {
      sessionId: "s1",
      projectRoot: makeProject(),
      toolLocations: new Map(),
    }
    const start = mapSessionEvent(state, {type: "agent_start"} as never)
    expect(start.activeMessageId).toBeTruthy()
    expect(start.events[0]?.kind).toBe("message")

    const withId = {...state, activeMessageId: start.activeMessageId}
    const delta = mapSessionEvent(withId, {
      type: "message_update",
      assistantMessageEvent: {type: "text_delta", delta: "hello"},
    } as never)
    expect(delta.events[0]).toMatchObject({
      kind: "partDelta",
      partKind: "text",
      delta: "hello",
    })
  })

  test("modelKey / resolveModel / toModelOption round-trip", () => {
    const model = {
      provider: "openai",
      id: "gpt",
      name: "GPT",
      reasoning: true,
    }
    expect(modelKey(model)).toBe("openai/gpt")
    expect(toModelOption(model as never)).toMatchObject({
      id: "openai/gpt",
      supportsThinking: true,
      label: "GPT",
    })
    expect(
      resolveModel(
        {
          find: (provider, id) =>
            provider === "openai" && id === "gpt" ? (model as never) : undefined,
        },
        "openai/gpt",
      ),
    ).toBe(model)
    expect(resolveModel({find: () => undefined}, "bad")).toBeUndefined()
  })

  test("formatPrompt embeds file and selection contexts", () => {
    const projectRoot = makeProject()
    fs.writeFileSync(path.join(projectRoot, "a.ts"), "x")
    const prompt = formatPrompt("ask", [
      {id: "1", kind: "file", path: "a.ts"},
      {id: "2", kind: "selection", path: "a.ts", text: "const x = 1", startLine: 1, endLine: 1},
    ], projectRoot)
    expect(prompt).toContain("<file path=\"a.ts\" />")
    expect(prompt).toContain("<selection path=\"a.ts\" lines 1>")
    expect(prompt).toContain("const x = 1")
    expect(firstLine("hello\nworld")).toBe("hello")
  })
})
