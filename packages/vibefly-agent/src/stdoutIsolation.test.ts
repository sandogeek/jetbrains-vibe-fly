import {afterEach, beforeEach, describe, test} from "node:test"
import {expect} from "expect"
import {redirectConsoleToStderr} from "./stdoutIsolation.js"

describe("redirectConsoleToStderr", () => {
    let stdoutChunks: string[]
    let stderrChunks: string[]
    let origStdoutWrite: typeof process.stdout.write
    let origStderrWrite: typeof process.stderr.write

    beforeEach(() => {
        stdoutChunks = []
        stderrChunks = []
        origStdoutWrite = process.stdout.write.bind(process.stdout)
        origStderrWrite = process.stderr.write.bind(process.stderr)
        process.stdout.write = ((chunk: string | Uint8Array) => {
            stdoutChunks.push(
                typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
            )
            return true
        }) as typeof process.stdout.write
        process.stderr.write = ((chunk: string | Uint8Array) => {
            stderrChunks.push(
                typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
            )
            return true
        }) as typeof process.stderr.write
    })

    afterEach(() => {
        process.stdout.write = origStdoutWrite
        process.stderr.write = origStderrWrite
    })

    test("console.log / info / debug do not write to stdout", () => {
        console.log("log-msg")
        console.info("info-msg")
        console.debug("debug-msg")

        expect(stdoutChunks.join("")).toBe("")
        const stderr = stderrChunks.join("")
        expect(stderr).toContain("log-msg")
        expect(stderr).toContain("info-msg")
        expect(stderr).toContain("debug-msg")
        expect(stderr).toContain("[vibefly-agent:stdout-redirect]")
    })

    test("console.dir / table do not write to stdout", () => {
        console.dir({a: 1})
        console.table([{x: 2}])

        expect(stdoutChunks.join("")).toBe("")
        const stderr = stderrChunks.join("")
        expect(stderr).toContain("[vibefly-agent:stdout-redirect]")
    })

    test("idempotent install does not stack wrappers", () => {
        redirectConsoleToStderr()
        redirectConsoleToStderr()
        console.log("once")
        const hits =
            stderrChunks.join("").split("[vibefly-agent:stdout-redirect]").length - 1
        expect(hits).toBe(1)
    })
})
