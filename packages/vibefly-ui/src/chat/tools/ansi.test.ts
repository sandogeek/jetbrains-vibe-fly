import {describe, test} from "node:test"
import {expect} from "expect"
import {ansiLineIsEmpty, parseAnsiLines} from "./ansi"

describe("parseAnsiLines", () => {
    test("strips SGR codes and splits on newlines", () => {
        const lines = parseAnsiLines("plain\nsecond")
        expect(lines).toHaveLength(2)
        expect(lines[0]).toEqual([{text: "plain", style: undefined}])
        expect(lines[1]).toEqual([{text: "second", style: undefined}])
    })

    test("maps basic colors and decorations onto styles", () => {
        const redBold = parseAnsiLines("\u001b[31;1mfail\u001b[0m")
        expect(redBold).toHaveLength(1)
        expect(redBold[0]?.[0]?.text).toBe("fail")
        expect(redBold[0]?.[0]?.style).toMatchObject({
            color: "var(--vf-danger)",
            fontWeight: 700,
        })

        const underline = parseAnsiLines("\u001b[4mnote\u001b[0m")
        expect(underline[0]?.[0]?.style).toMatchObject({textDecoration: "underline"})
    })

    test("drops OSC sequences so they never reach the DOM", () => {
        const lines = parseAnsiLines("\u001b]0;title\u0007visible")
        expect(lines[0]).toEqual([{text: "visible", style: undefined}])
        expect(ansiLineIsEmpty([])).toBe(true)
    })
})
