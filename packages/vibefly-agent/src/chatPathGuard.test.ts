import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, test } from "node:test"
import { expect } from "expect"
import { pathInsideProject, validateToolPaths } from "./chatSessionRegistry.js"

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe("chat project path guard", () => {
  test("accepts project-relative paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibefly-path-"))
    tempDirs.push(root)
    expect(pathInsideProject(root, "src/new.ts")).toBe(path.join(fs.realpathSync(root), "src/new.ts"))
  })

  test("rejects absolute paths and parent traversal", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibefly-path-"))
    tempDirs.push(root)
    expect(() => pathInsideProject(root, "/tmp/outside.txt")).toThrow()
    expect(() => pathInsideProject(root, "../outside.txt")).toThrow()
  })

  test("rejects writes through a symlinked parent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibefly-path-"))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "vibefly-outside-"))
    tempDirs.push(root, outside)
    fs.symlinkSync(outside, path.join(root, "linked"))
    expect(() => pathInsideProject(root, "linked/new.txt")).toThrow(/outside the project/)
  })

  test("rejects file URIs and hashline edit escapes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibefly-path-"))
    tempDirs.push(root)
    expect(() => validateToolPaths(root, "write", { path: "file:///tmp/outside.txt" })).toThrow(
      /outside the project workspace/,
    )
    expect(() => validateToolPaths(root, "edit", { input: "[../outside.txt#ABCD]\nreplacement" })).toThrow(
      /escapes the project/,
    )
  })

  test("validates edit rename destinations", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibefly-path-"))
    tempDirs.push(root)
    expect(() =>
      validateToolPaths(root, "edit", {
        path: "src/input.ts",
        edits: [{ op: "update", rename: "../outside.ts" }],
      }),
    ).toThrow(/escapes the project/)
    expect(() =>
      validateToolPaths(root, "edit", {
        input: "*** Update File: src/input.ts\n*** Move to: ../../outside.ts",
      }),
    ).toThrow(/escapes the project/)
  })

  test("allows read-only web and pi resource URIs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibefly-path-"))
    tempDirs.push(root)
    expect(() => validateToolPaths(root, "read", { path: "https://example.com/docs" })).not.toThrow()
    expect(() => validateToolPaths(root, "read", { path: "skill://example/reference" })).not.toThrow()
  })
})
