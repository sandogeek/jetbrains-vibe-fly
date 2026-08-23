import {describe, test} from "node:test"
import {expect} from "expect"
import {presentRead} from "./presentRead"
describe("presentRead", () => {
    test("numbers lines from offset", () => {
        const card = presentRead(
            {path: "src/a.ts", offset: 12, limit: 50},
            "export const a = 1\nexport const b = 2\n",
        )
        expect(card).toMatchObject({
            path: "src/a.ts",
            offset: 12,
            totalLines: 2,
            lang: "ts",
        })
        expect(card?.lines).toEqual([
            {number: 12, text: "export const a = 1"},
            {number: 13, text: "export const b = 2"},
        ])
    })
    test("defaults offset to 1 and accepts file_path", () => {
        const card = presentRead({file_path: "notes.md"}, "hello")
        expect(card).toMatchObject({
            path: "notes.md",
            offset: 1,
            lang: "md",
            lines: [{number: 1, text: "hello"}],
            totalLines: 1,
        })
    })
    test("empty file is an empty window, not null", () => {
        expect(presentRead({path: "empty.txt"}, "")).toEqual({
            path: "empty.txt",
            offset: 1,
            lines: [],
            totalLines: 0,
            lang: undefined,
        })
    })
    test("does not invent a whole-file total when limit is set", () => {
        const card = presentRead({path: "src/a.ts", offset: 1, limit: 8}, "one\ntwo")
        expect(card?.totalLines).toBe(2)
        expect(card?.lines).toHaveLength(2)
    })
    test("returns null while running or when args are malformed", () => {
        expect(presentRead({path: "src/a.ts"}, undefined)).toBeNull()
        expect(presentRead({offset: 4}, "body")).toBeNull()
        expect(presentRead(null, "body")).toBeNull()
        expect(presentRead("src/a.ts", "body")).toBeNull()
    })
})
