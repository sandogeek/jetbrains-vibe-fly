import { describe, expect, test } from "bun:test"
import {
  getLoginProviders,
  providerSupportsLogin,
  resolveLoginProviderId,
} from "./providerLogin.js"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("login providers", () => {
  test("resolveLoginProviderId maps known OAuth providers", () => {
    expect(resolveLoginProviderId("anthropic")).toBe("anthropic")
    expect(providerSupportsLogin("anthropic")).toBe(true)
    expect(providerSupportsLogin("openai")).toBe(false)
  })

  test("getLoginProviders lists Oh My Pi login registry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vibefly-login-"))
    try {
      const list = await getLoginProviders(dir)
      const ids = (list.providers ?? []).map((p) => p.id)
      expect(ids).toContain("anthropic")
      expect(ids).toContain("github-copilot")
      expect(ids.length).toBeGreaterThan(10)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
