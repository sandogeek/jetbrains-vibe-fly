import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {afterEach, describe, test} from "node:test"
import {expect} from "expect"
import {mapSessionEvent, toChatMessages} from "./eventMapper.js"
import {locationsFromArgs} from "./toolPathGuard.js"
import {toolResultText} from "./util.js"

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, {recursive: true, force: true})
})

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibefly-mapper-"))
  tempDirs.push(root)
  return fs.realpathSync(root)
}

describe("toolResultText", () => {
  test("extracts text from structured pi results instead of JSON-dumping", () => {
    expect(
      toolResultText({
        content: [{type: "text", text: "line one\nline two"}],
        details: {truncation: {totalLines: 80}},
      }),
    ).toBe("line one\nline two")
    expect(toolResultText("already a string")).toBe("already a string")
    expect(toolResultText({content: "plain"})).toBe("plain")
  })
})

describe("locationsFromArgs", () => {
  test("accepts file_path and fills read line from offset", () => {
    const projectRoot = makeProject()
    expect(locationsFromArgs({file_path: "src/a.ts", offset: 12}, projectRoot, "read")).toEqual([
      {path: "src/a.ts", line: 12},
    ])
    expect(locationsFromArgs({path: "src/a.ts"}, projectRoot, "read")).toEqual([
      {path: "src/a.ts", line: 1},
    ])
    expect(locationsFromArgs({path: "src/a.ts"}, projectRoot, "write")).toEqual([
      {path: "src/a.ts"},
    ])
  })
})

describe("toChatMessages history locations", () => {
  test("recomputes locations from toolCall arguments", () => {
    const projectRoot = makeProject()
    const messages = toChatMessages(
      [
        {
          role: "assistant",
          id: "a1",
          timestamp: 1,
          content: [
            {type: "toolCall", id: "t1", name: "read", arguments: {path: "a.ts", offset: 40}},
          ],
        },
        {
          role: "toolResult",
          toolCallId: "t1",
          content: "file body",
          isError: false,
        },
      ] as never,
      projectRoot,
    )
    const tool = messages[0]!.parts.find((part) => part.kind === "tool")
    expect(tool).toMatchObject({
      toolCallId: "t1",
      output: "file body",
      status: "completed",
      locations: [{path: "a.ts", line: 40}],
    })
  })
})

describe("mapSessionEvent tool updates", () => {
  test("replaces bash output snapshots while running, then settles", () => {
    const projectRoot = makeProject()
    const state = {
      sessionId: "s1",
      projectRoot,
      activeMessageId: "assistant-1",
      toolLocations: new Map(),
    }
    mapSessionEvent(state, {
      type: "tool_execution_start",
      toolCallId: "t-bash",
      toolName: "bash",
      args: {command: "pnpm test"},
    } as never)

    const update = mapSessionEvent(state, {
      type: "tool_execution_update",
      toolCallId: "t-bash",
      toolName: "bash",
      args: {command: "pnpm test"},
      partialResult: {content: [{type: "text", text: "ok 1"}]},
    } as never)
    expect(update.events[0]).toMatchObject({
      kind: "tool",
      part: {
        toolCallId: "t-bash",
        name: "bash",
        status: "running",
        output: "ok 1",
      },
    })
    expect(
      (update.events[0] as {part: {input?: unknown}}).part.input,
    ).toBeUndefined()

    const later = mapSessionEvent(state, {
      type: "tool_execution_update",
      toolCallId: "t-bash",
      toolName: "bash",
      args: {command: "pnpm test"},
      partialResult: {content: [{type: "text", text: "ok 1\nok 2"}]},
    } as never)
    expect(later.events[0]).toMatchObject({
      part: {output: "ok 1\nok 2", status: "running"},
    })

    const end = mapSessionEvent(state, {
      type: "tool_execution_end",
      toolCallId: "t-bash",
      toolName: "bash",
      isError: false,
      result: {content: [{type: "text", text: "ok 1\nok 2\n\nCommand exited with code 0"}]},
    } as never)
    expect(end.events[0]).toMatchObject({
      part: {
        status: "completed",
        output: "ok 1\nok 2\n\nCommand exited with code 0",
      },
    })
  })

  test("emits an update without a prior start when the assistant message is live", () => {
    const state = {
      sessionId: "s1",
      projectRoot: makeProject(),
      activeMessageId: "assistant-1",
      toolLocations: new Map(),
    }
    const update = mapSessionEvent(state, {
      type: "tool_execution_update",
      toolCallId: "orphan",
      toolName: "bash",
      args: {command: "echo"},
      partialResult: "hi",
    } as never)
    expect(update.events[0]).toMatchObject({
      kind: "tool",
      part: {toolCallId: "orphan", status: "running", output: "hi"},
    })
  })
})

describe("mapSessionEvent tool results", () => {
  test("flattens structured read results and keeps the start-time locations", () => {
    const projectRoot = makeProject()
    const state = {
      sessionId: "s1",
      projectRoot,
      activeMessageId: "assistant-1",
      toolLocations: new Map(),
    }
    const start = mapSessionEvent(state, {
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "read",
      args: {path: "src/a.ts", offset: 12},
    } as never)
    const startPart = start.events[0]
    expect(startPart).toMatchObject({
      kind: "tool",
      part: {
        name: "read",
        status: "running",
        locations: [{path: "src/a.ts", line: 12}],
      },
    })

    const end = mapSessionEvent(state, {
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "read",
      isError: false,
      result: {
        content: [{type: "text", text: "export const a = 1"}],
        details: {truncation: {totalLines: 180}},
      },
    } as never)
    expect(end.events[0]).toMatchObject({
      kind: "tool",
      part: {
        status: "completed",
        output: "export const a = 1",
        locations: [{path: "src/a.ts", line: 12}],
      },
    })
  })
})
