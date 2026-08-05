import { describe, test } from "node:test"
import { expect } from "expect"
import type { ChatMessage } from "@vibefly/uiagent-shared"
import { convertChatMessage, type ToolArtifact } from "./chatMessageAdapter"

describe("convertChatMessage", () => {
  test("maps streaming text and reasoning parts", () => {
    const message: ChatMessage = {
      id: "assistant-1",
      role: "assistant",
      status: "streaming",
      createdAt: 1_725_000_000_000,
      parts: [
        { kind: "thinking", text: "Inspect the cancellation path." },
        { kind: "text", text: "I found the race." },
      ],
    }

    const converted = convertChatMessage(message)

    expect(converted.id).toBe(message.id)
    expect(converted.createdAt).toEqual(new Date(message.createdAt))
    expect(converted.status).toEqual({ type: "running" })
    expect(converted.content).toEqual([
      { type: "reasoning", text: "Inspect the cancellation path." },
      { type: "text", text: "I found the race." },
    ])
  })

  test("preserves tool UI metadata in the artifact", () => {
    const converted = convertChatMessage({
      id: "assistant-2",
      role: "assistant",
      status: "complete",
      createdAt: 1,
      parts: [
        {
          kind: "tool",
          toolCallId: "tool-1",
          name: "edit",
          status: "completed",
          input: { path: "src/App.tsx" },
          output: "+2 -1",
          locations: [{ path: "src/App.tsx", line: 42 }],
        },
      ],
    })
    const content = converted.content as Exclude<typeof converted.content, string>
    const tool = content[0]

    expect(converted.status).toEqual({ type: "complete", reason: "stop" })
    expect(tool).toMatchObject({
      type: "tool-call",
      toolCallId: "tool-1",
      toolName: "edit",
      argsText: '{"path":"src/App.tsx"}',
      result: "+2 -1",
    })
    expect((tool as { artifact: ToolArtifact }).artifact).toEqual({
      status: "completed",
      output: "+2 -1",
      locations: [{ path: "src/App.tsx", line: 42 }],
    })
  })

  test("maps notices and terminal error states", () => {
    const converted = convertChatMessage({
      id: "system-1",
      role: "system",
      status: "error",
      createdAt: 1,
      parts: [{ kind: "notice", level: "error", text: "Connection lost" }],
    })

    // system → assistant so assistant-ui accepts status + data parts
    expect(converted.role).toBe("assistant")
    expect(converted.status).toEqual({ type: "incomplete", reason: "error" })
    expect(converted.content).toEqual([
      {
        type: "data",
        name: "vibefly-notice",
        data: { level: "error", text: "Connection lost" },
      },
    ])
  })

  test("omits status on user messages", () => {
    const converted = convertChatMessage({
      id: "user-1",
      role: "user",
      status: "complete",
      createdAt: 1,
      parts: [{ kind: "text", text: "hello" }],
    })

    expect(converted.role).toBe("user")
    expect(converted.status).toBeUndefined()
    expect(converted.content).toEqual([{ type: "text", text: "hello" }])
  })
})
