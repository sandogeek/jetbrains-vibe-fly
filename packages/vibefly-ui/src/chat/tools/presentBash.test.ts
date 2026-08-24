import {describe, test} from "node:test"
import {expect} from "expect"
import {bashCommandFailed, presentBash, splitCommandStatus} from "./presentBash"

describe("presentBash", () => {
    test("keeps the command while running, with or without output", () => {
        expect(presentBash({command: "pnpm test"}, undefined, true)).toEqual({
            command: "pnpm test",
            running: true,
        })
        expect(presentBash({command: "pnpm test"}, "ok\n", true)).toMatchObject({
            command: "pnpm test",
            output: "ok\n",
            running: true,
        })
    })

    test("strips DSH and pi exit/signal markers and keeps truncation footers", () => {
        const dsh = presentBash(
            {command: "false"},
            "boom\n\n[exit code: 1]",
            false,
        )
        expect(dsh).toMatchObject({output: "boom", exitCode: 1, running: false})
        expect(bashCommandFailed(dsh!)).toBe(true)

        const pi = presentBash(
            {command: "false"},
            "boom\n\nCommand exited with code 3",
            false,
        )
        expect(pi).toMatchObject({output: "boom", exitCode: 3})

        const signal = splitCommandStatus("log\n\n[killed by signal: SIGTERM]")
        expect(signal).toEqual({body: "log", signal: "SIGTERM"})

        const truncated = presentBash(
            {command: "yes"},
            "tail\n\n[Showing lines 10-20 of 200. Full output: /tmp/out]",
            false,
        )
        expect(truncated?.output).toContain("[Showing lines 10-20 of 200.")
        expect(truncated?.exitCode).toBeUndefined()
    })

    test("treats (no output) as an empty body and exit 0 as success", () => {
        const empty = presentBash({command: "true"}, "(no output)\n\n[exit code: 0]", false)
        expect(empty).toMatchObject({output: "", exitCode: 0})
        expect(bashCommandFailed(empty!)).toBe(false)
        expect(presentBash({timeout: 1}, "hi", false)).toBeNull()
    })
})
