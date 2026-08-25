import {describe, test} from "node:test"
import {expect} from "expect"
import type {ChatMessage} from "@vibefly/uiagent-shared"
import {toChatMessages} from "./eventMapper.js"
import {
  THINKING_DURATION_CUSTOM_TYPE,
  ThinkingDurationClock,
  applyThinkingDurations,
  noteThinkingDurationEvent,
  parseThinkingDurationData,
  recordsFromBranch,
} from "./thinkingDuration.js"

describe("ThinkingDurationClock", () => {
  test("records start/end and sorts by contentIndex", () => {
    const clock = new ThinkingDurationClock()
    clock.noteStart(2, 1_000)
    clock.noteStart(0, 100)
    clock.noteEnd(0, 400)
    clock.noteEnd(2, 1_500)
    expect(clock.take()).toEqual([
      {contentIndex: 0, startedAt: 100, endedAt: 400},
      {contentIndex: 2, startedAt: 1_000, endedAt: 1_500},
    ])
    expect(clock.take()).toEqual([])
  })

  test("closeOpen stamps abort/error on still-open blocks", () => {
    const clock = new ThinkingDurationClock()
    clock.noteStart(0, 100)
    clock.closeOpen(250)
    expect(clock.take()).toEqual([{contentIndex: 0, startedAt: 100, endedAt: 250}])
  })

  test("ignores a second start for the same contentIndex", () => {
    const clock = new ThinkingDurationClock()
    clock.noteStart(0, 100)
    clock.noteStart(0, 999)
    clock.noteEnd(0, 200)
    expect(clock.take()).toEqual([{contentIndex: 0, startedAt: 100, endedAt: 200}])
  })
})

describe("noteThinkingDurationEvent", () => {
  test("emits a persist payload on assistant message_end after thinking_start/end", () => {
    const clock = new ThinkingDurationClock()
    expect(
      noteThinkingDurationEvent(clock, {type: "agent_start"} as never, 1),
    ).toBeUndefined()
    expect(
      noteThinkingDurationEvent(
        clock,
        {
          type: "message_update",
          assistantMessageEvent: {type: "thinking_start", contentIndex: 0},
        } as never,
        100,
      ),
    ).toBeUndefined()
    expect(
      noteThinkingDurationEvent(
        clock,
        {
          type: "message_update",
          assistantMessageEvent: {type: "thinking_end", contentIndex: 0},
        } as never,
        450,
      ),
    ).toBeUndefined()

    const payload = noteThinkingDurationEvent(
      clock,
      {
        type: "message_end",
        message: {
          role: "assistant",
          timestamp: 99,
          content: [{type: "thinking", thinking: "ponder"}, {type: "text", text: "ok"}],
        },
      } as never,
      500,
    )
    expect(payload).toEqual({
      messageTimestamp: 99,
      blocks: [{contentIndex: 0, startedAt: 100, endedAt: 450}],
    })
  })

  test("closes an open block when message_end arrives without thinking_end", () => {
    const clock = new ThinkingDurationClock()
    noteThinkingDurationEvent(
      clock,
      {
        type: "message_update",
        assistantMessageEvent: {type: "thinking_start", contentIndex: 0},
      } as never,
      100,
    )
    const payload = noteThinkingDurationEvent(
      clock,
      {
        type: "message_end",
        message: {
          role: "assistant",
          timestamp: 50,
          content: [{type: "thinking", thinking: "partial"}],
          stopReason: "aborted",
        },
      } as never,
      180,
    )
    expect(payload).toEqual({
      messageTimestamp: 50,
      blocks: [{contentIndex: 0, startedAt: 100, endedAt: 180}],
    })
  })

  test("does not persist when the assistant message has no thinking", () => {
    const clock = new ThinkingDurationClock()
    noteThinkingDurationEvent(
      clock,
      {
        type: "message_update",
        assistantMessageEvent: {type: "thinking_start", contentIndex: 0},
      } as never,
      100,
    )
    expect(
      noteThinkingDurationEvent(
        clock,
        {
          type: "message_end",
          message: {
            role: "assistant",
            timestamp: 1,
            content: [{type: "text", text: "no thinking"}],
          },
        } as never,
        200,
      ),
    ).toBeUndefined()
    expect(clock.take()).toEqual([])
  })
})

describe("recordsFromBranch / applyThinkingDurations", () => {
  test("restores timestamps onto matching thinking parts", () => {
    const records = recordsFromBranch([
      {type: "message"},
      {
        type: "custom",
        customType: THINKING_DURATION_CUSTOM_TYPE,
        data: {
          messageTimestamp: 1_000,
          blocks: [{contentIndex: 0, startedAt: 1_000, endedAt: 1_340}],
        },
      },
      {
        type: "custom",
        customType: "other.extension",
        data: {messageTimestamp: 1_000, blocks: []},
      },
    ])
    expect(records).toEqual([
      {messageTimestamp: 1_000, blocks: [{contentIndex: 0, startedAt: 1_000, endedAt: 1_340}]},
    ])

    const messages: ChatMessage[] = [
      {
        id: "history-0",
        role: "assistant",
        status: "complete",
        createdAt: 1_000,
        parts: [
          {kind: "thinking", text: "ponder"},
          {kind: "text", text: "answer"},
        ],
      },
    ]
    applyThinkingDurations(messages, records)
    expect(messages[0]!.parts[0]).toMatchObject({
      kind: "thinking",
      startedAt: 1_000,
      endedAt: 1_340,
    })
  })

  test("skips records whose timestamp does not match a thinking message", () => {
    const messages: ChatMessage[] = [
      {
        id: "history-0",
        role: "assistant",
        status: "complete",
        createdAt: 5,
        parts: [{kind: "thinking", text: "old"}],
      },
    ]
    applyThinkingDurations(messages, [
      {messageTimestamp: 99, blocks: [{contentIndex: 0, startedAt: 1, endedAt: 2}]},
    ])
    expect(messages[0]!.parts[0]).toEqual({kind: "thinking", text: "old"})
  })

  test("rejects malformed custom entry payloads", () => {
    expect(parseThinkingDurationData(null)).toBeUndefined()
    expect(parseThinkingDurationData({messageTimestamp: 1, blocks: "nope"})).toBeUndefined()
    expect(
      parseThinkingDurationData({
        messageTimestamp: 1,
        blocks: [{contentIndex: 0, startedAt: 1}],
      }),
    ).toBeUndefined()
  })
})

describe("toChatMessages thinking duration restore", () => {
  test("fills startedAt/endedAt from duration records", () => {
    const messages = toChatMessages(
      [
        {
          role: "assistant",
          timestamp: 42,
          content: [
            {type: "thinking", thinking: "hmm"},
            {type: "text", text: "done"},
          ],
        },
      ] as never,
      undefined,
      [{messageTimestamp: 42, blocks: [{contentIndex: 0, startedAt: 40, endedAt: 80}]}],
    )
    expect(messages[0]!.parts[0]).toMatchObject({
      kind: "thinking",
      text: "hmm",
      startedAt: 40,
      endedAt: 80,
    })
  })

  test("leaves thinking parts untimed when no duration record matches", () => {
    const messages = toChatMessages(
      [
        {
          role: "assistant",
          timestamp: 42,
          content: [{type: "thinking", thinking: "hmm"}],
        },
      ] as never,
    )
    expect(messages[0]!.parts[0]).toEqual({kind: "thinking", text: "hmm"})
  })
})
