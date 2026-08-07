import {describe, test} from "node:test"
import {expect} from "expect"
import {formatConsoleMessage, redactLogText} from "./console.js"

describe("console redaction", () => {
    test("redacts secret-shaped object fields before forwarding", () => {
        const message = formatConsoleMessage("info", [{
            provider: "openai",
            apiKey: "sk-object-secret",
            nested: {accessToken: "oauth-token", visible: "ok"},
        }])

        expect(message).toContain('"provider":"openai"')
        expect(message).toContain('"visible":"ok"')
        expect(message).not.toContain("sk-object-secret")
        expect(message).not.toContain("oauth-token")
    })

    test("redacts common bearer and API-key text forms", () => {
        const message = redactLogText(
            'Authorization: Bearer abc.def sk-live_123456789 apiKey="plain-value" refresh_token=oauth-value',
        )

        expect(message).not.toContain("abc.def")
        expect(message).not.toContain("sk-live_123456789")
        expect(message).not.toContain("plain-value")
        expect(message).not.toContain("oauth-value")
        expect(message).toContain("[REDACTED]")
    })
})
