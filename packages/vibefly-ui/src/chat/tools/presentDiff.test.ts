import {describe, test} from "node:test"
import {expect} from "expect"
import {contentLines} from "./contentLines"
import {buildDiffRows, presentEdit, presentWrite} from "./presentDiff"
describe("presentWrite", () => {
    test("creates a whole-file hunk with no prior content", () => {
        expect(presentWrite({path: "notes.txt", content: "hello\n"})).toEqual([
            {path: "notes.txt", oldText: null, newText: "hello\n"},
        ])
    })
    test("allows an empty file write", () => {
        expect(presentWrite({file_path: "empty.txt", content: ""})).toEqual([
            {path: "empty.txt", oldText: null, newText: ""},
        ])
    })
    test("returns null when path or content is missing", () => {
        expect(presentWrite({path: "a.ts"})).toBeNull()
        expect(presentWrite({content: "hello"})).toBeNull()
        expect(presentWrite(null)).toBeNull()
    })
})
describe("presentEdit", () => {
    test("maps edits[] into per-replacement hunks", () => {
        expect(
            presentEdit({
                path: "src/a.ts",
                edits: [
                    {oldText: "retries: 1", newText: "retries: 3"},
                    {oldText: "hello", newText: "hello fixture"},
                ],
            }),
        ).toEqual([
            {path: "src/a.ts", oldText: "retries: 1", newText: "retries: 3"},
            {path: "src/a.ts", oldText: "hello", newText: "hello fixture"},
        ])
    })
    test("accepts legacy top-level oldText/newText", () => {
        expect(presentEdit({path: "src/a.ts", oldText: "a", newText: "b"})).toEqual([
            {path: "src/a.ts", oldText: "a", newText: "b"},
        ])
    })
    test("returns null for malformed replacements", () => {
        expect(presentEdit({path: "src/a.ts", edits: [{oldText: "a"}]})).toBeNull()
        expect(presentEdit({path: "src/a.ts"})).toBeNull()
        expect(presentEdit({edits: [{oldText: "a", newText: "b"}]})).toBeNull()
    })
})
describe("buildDiffRows", () => {
    test("opens a same-file second hunk with a gap", () => {
        const model = buildDiffRows([
            {path: "src/a.ts", oldText: "hello", newText: "hello fixture"},
            {path: "src/a.ts", oldText: "retries: 1", newText: "retries: 3"},
        ])
        expect(model.files).toBe(1)
        expect(model.added).toBe(2)
        expect(model.removed).toBe(2)
        expect(model.rows.map((row) => row.kind)).toEqual([
            "path",
            "del",
            "add",
            "gap",
            "del",
            "add",
        ])
        expect(model.rows[3]).toEqual({kind: "gap", text: "⋯"})
    })
    test("omits the removed side for a create hunk", () => {
        const model = buildDiffRows([{path: "new.txt", oldText: null, newText: "one\ntwo\n"}])
        expect(model).toEqual({
            added: 2,
            removed: 0,
            files: 1,
            rows: [
                {kind: "path", text: "new.txt"},
                {kind: "add", text: "one"},
                {kind: "add", text: "two"},
            ],
        })
    })
})
describe("contentLines", () => {
    test("treats a trailing newline as a terminator", () => {
        expect(contentLines("")).toEqual([])
        expect(contentLines("one\n")).toEqual(["one"])
        expect(contentLines("one\n\ntwo\n")).toEqual(["one", "", "two"])
        expect(contentLines("one")).toEqual(["one"])
    })
})
