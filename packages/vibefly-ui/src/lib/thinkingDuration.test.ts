import {describe, test} from "node:test"
import {expect} from "expect"

import {formatThinkingSeconds} from "./thinkingDuration"

describe("formatThinkingSeconds", () => {
    test("hides durations below 0.1s", () => {
        expect(formatThinkingSeconds(0)).toBeUndefined()
        expect(formatThinkingSeconds(99)).toBeUndefined()
        expect(formatThinkingSeconds(-500)).toBeUndefined()
    })

    test("shows at least 0.1s", () => {
        expect(formatThinkingSeconds(100)).toBe("0.1")
        expect(formatThinkingSeconds(150)).toBe("0.1")
    })

    test("floors to a 0.1s step without overstating", () => {
        expect(formatThinkingSeconds(199)).toBe("0.1")
        expect(formatThinkingSeconds(3400)).toBe("3.4")
        expect(formatThinkingSeconds(3499)).toBe("3.4")
    })

    test("renders whole seconds without decimals", () => {
        expect(formatThinkingSeconds(12_000)).toBe("12")
        expect(formatThinkingSeconds(12_400)).toBe("12.4")
    })
})
