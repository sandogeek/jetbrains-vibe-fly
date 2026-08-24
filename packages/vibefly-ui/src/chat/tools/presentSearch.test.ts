import {describe, test} from "node:test"
import {expect} from "expect"
import {presentGrep, presentPaths, splitTrailingNotice} from "./presentSearch"

describe("presentGrep", () => {
    test("groups matches by file in first-seen order", () => {
        const card = presentGrep(
            [
                "src/a.ts:12: const foo = 1",
                "src/a.ts:40: return foo",
                "src/b.ts:7: foo()",
            ].join("\n"),
        )
        expect(card).toEqual({
            kind: "matches",
            truncated: false,
            total: 3,
            files: [
                {
                    path: "src/a.ts",
                    matches: [
                        {lineNumber: 12, line: "const foo = 1"},
                        {lineNumber: 40, line: "return foo"},
                    ],
                },
                {path: "src/b.ts", matches: [{lineNumber: 7, line: "foo()"}]},
            ],
        })
    })

    test("includes context lines and empty results", () => {
        const withContext = presentGrep("src/a.ts-11- before\nsrc/a.ts:12: hit\nsrc/a.ts-13- after")
        expect(withContext?.kind).toBe("matches")
        if (withContext?.kind === "matches") {
            expect(withContext.files[0]?.matches).toHaveLength(3)
            expect(withContext.files[0]?.matches[0]).toEqual({lineNumber: 11, line: "before"})
        }
        expect(presentGrep("No matches found")).toEqual({
            kind: "matches",
            files: [],
            truncated: false,
            total: 0,
        })
        expect(presentGrep(undefined)).toBeNull()
        expect(presentGrep("ripgrep exploded")).toBeNull()
    })

    test("lifts a trailing notice into recovery", () => {
        const card = presentGrep("src/a.ts:1: x\n\n[100 matches limit reached. Use limit=200 for more]")
        expect(card).toMatchObject({
            truncated: true,
            recovery: "100 matches limit reached. Use limit=200 for more",
            total: 1,
        })
    })
})

describe("presentPaths", () => {
    test("keeps find paths and ls directory markers", () => {
        expect(presentPaths("src/a.ts\nsrc/b.ts\n")).toEqual({
            kind: "paths",
            paths: ["src/a.ts", "src/b.ts"],
            truncated: false,
            total: 2,
        })
        expect(presentPaths("src/\nREADME.md")).toEqual({
            kind: "paths",
            paths: ["src/", "README.md"],
            truncated: false,
            total: 2,
        })
        expect(presentPaths("No files found matching pattern")).toEqual({
            kind: "paths",
            paths: [],
            truncated: false,
            total: 0,
        })
        expect(presentPaths("(empty directory)")).toMatchObject({kind: "paths", paths: []})
    })

    test("surfaces find/ls truncation notices", () => {
        expect(splitTrailingNotice("a.ts\n\n[1000 results limit reached]")).toEqual({
            body: "a.ts",
            recovery: "1000 results limit reached",
        })
        const card = presentPaths("a.ts\n\n[500 entries limit reached. Use limit=1000 for more]")
        expect(card).toMatchObject({truncated: true, recovery: "500 entries limit reached. Use limit=1000 for more"})
    })
})
