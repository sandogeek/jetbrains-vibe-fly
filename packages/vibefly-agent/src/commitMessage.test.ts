import { describe, expect, test } from "bun:test"
import {
  buildCustomCommitModel,
  buildSystemPrompt,
  buildUserPrompt,
  formatRecentExamples,
  languageInstruction,
  resolveCommitLanguage,
  sanitizeCommitMessage,
} from "./commitMessage.js"

describe("sanitizeCommitMessage", () => {
  test("trims and returns plain subject", () => {
    expect(sanitizeCommitMessage("  feat: add button  \n")).toBe("feat: add button")
  })

  test("strips markdown fences", () => {
    const raw = "```\nfix: handle null\n```"
    expect(sanitizeCommitMessage(raw)).toBe("fix: handle null")
  })

  test("strips language-tagged fences", () => {
    const raw = "```text\nchore: bump deps\n```"
    expect(sanitizeCommitMessage(raw)).toBe("chore: bump deps")
  })

  test("strips surrounding quotes", () => {
    expect(sanitizeCommitMessage('"docs: update readme"')).toBe("docs: update readme")
  })

  test("strips leading label", () => {
    expect(sanitizeCommitMessage("Commit message: feat: add login")).toBe(
      "feat: add login",
    )
    expect(sanitizeCommitMessage("提交信息：fix: 修复空指针")).toBe(
      "fix: 修复空指针",
    )
  })

  test("keeps short body", () => {
    const raw = "feat: add login\n\n- form validation\n- error states"
    expect(sanitizeCommitMessage(raw)).toBe(raw)
  })

  test("empty after sanitize", () => {
    expect(sanitizeCommitMessage("   ")).toBe("")
  })
})

describe("resolveCommitLanguage", () => {
  test("defaults to en", () => {
    expect(resolveCommitLanguage(undefined)).toBe("en")
    expect(resolveCommitLanguage("conventional_en")).toBe("en")
  })

  test("parses zh styles", () => {
    expect(resolveCommitLanguage("conventional_zh")).toBe("zh")
    expect(resolveCommitLanguage("zh-CN")).toBe("zh")
  })
})

describe("languageInstruction", () => {
  test("empty for english", () => {
    expect(languageInstruction("en")).toBe("")
    expect(languageInstruction(undefined)).toBe("")
  })

  test("requires non-english description language", () => {
    const text = languageInstruction("zh")
    expect(text).toContain("Language Requirement")
    expect(text).toContain("Chinese")
    expect(text).toContain("English")
  })
})

describe("buildSystemPrompt", () => {
  test("includes conventional format and language for zh", () => {
    const prompt = buildSystemPrompt("conventional_zh")
    expect(prompt).toContain("Conventional Commits")
    expect(prompt).toContain("feat")
    expect(prompt).toContain("Language Requirement")
  })

  test("no language block for en", () => {
    expect(buildSystemPrompt("conventional_en")).not.toContain(
      "Language Requirement",
    )
  })
})

describe("buildCustomCommitModel", () => {
  test("builds openai-responses model with custom base URL", () => {
    const model = buildCustomCommitModel("openai", "my-local-model", {
      api: "openai-responses",
      baseUrl: "http://127.0.0.1:8000/v1",
    })
    expect(model.provider).toBe("openai")
    expect(model.id).toBe("my-local-model")
    expect(model.api).toBe("openai-responses")
    expect(model.baseUrl).toBe("http://127.0.0.1:8000/v1")
  })

  test("defaults to openai-responses", () => {
    const model = buildCustomCommitModel("openai", "gpt-test")
    expect(model.api).toBe("openai-responses")
    expect(model.baseUrl).toBe("https://api.openai.com/v1")
  })
})

describe("formatRecentExamples", () => {
  test("empty when no messages", () => {
    expect(formatRecentExamples(undefined)).toBe("")
    expect(formatRecentExamples([])).toBe("")
  })

  test("formats few-shot block with dedupe", () => {
    const text = formatRecentExamples([
      "feat: 使用ast分析",
      "feat: 使用ast分析",
      "fix(ui): 修复主题色",
    ])
    expect(text).toContain("Recent commits in this repository")
    expect(text).toContain("EXAMPLE 1:")
    expect(text).toContain("feat: 使用ast分析")
    expect(text).toContain("EXAMPLE 2:")
    expect(text).toContain("fix(ui): 修复主题色")
    expect(text.match(/EXAMPLE /g)?.length).toBe(2)
  })
})

describe("buildUserPrompt", () => {
  test("emits per-file blocks with metadata and patch", () => {
    const prompt = buildUserPrompt({
      files: [
        {
          path: "a.kt",
          changeType: "MODIFIED",
          additions: 2,
          deletions: 1,
          truncated: true,
          diff: "--- a/a.kt\n+++ b/a.kt\n+x\n",
        },
        { path: "b.ts", changeType: "ADDED", additions: 5, deletions: 0 },
      ],
    })
    expect(prompt).toContain("FILE: a.kt")
    expect(prompt).toContain("STATUS: MODIFIED")
    expect(prompt).toContain("STATS: +2 -1")
    expect(prompt).toContain("PATCH_STATUS: partial")
    expect(prompt).toContain("<patch>")
    expect(prompt).toContain("+++ b/a.kt")
    expect(prompt).toContain("</patch>")
    expect(prompt).toContain("END_FILE")
    expect(prompt).toContain("FILE: b.ts")
    expect(prompt).toContain("STATUS: ADDED")
    expect(prompt).toContain("STATS: +5 -0")
    expect(prompt).toContain("partial or omitted")
  })

  test("includes recent commit few-shot examples", () => {
    const prompt = buildUserPrompt({
      files: [{ path: "a.kt", changeType: "MODIFIED", additions: 1 }],
      recentMessages: ["feat: 完善开发期依赖", "fix: 修复空指针"],
    })
    expect(prompt).toContain("Recent commits in this repository")
    expect(prompt).toContain("feat: 完善开发期依赖")
    expect(prompt).toContain("fix: 修复空指针")
    expect(prompt).toContain("FILE: a.kt")
  })

  test("includes rename and aggregates many lockfiles", () => {
    const prompt = buildUserPrompt({
      files: [
        {
          path: "new/A.kt",
          oldPath: "old/A.kt",
          changeType: "MOVED",
          additions: 1,
          deletions: 1,
          diff: "--- a/old/A.kt\n+++ b/new/A.kt\n+x\n",
        },
        {
          path: "yarn.lock",
          changeType: "MODIFIED",
          omittedReason: "lockfile",
        },
        {
          path: "package-lock.json",
          changeType: "MODIFIED",
          omittedReason: "lockfile",
        },
        {
          path: "pnpm-lock.yaml",
          changeType: "MODIFIED",
          omittedReason: "lockfile",
        },
      ],
    })
    expect(prompt).toContain("FILE: new/A.kt")
    expect(prompt).toContain("OLD_PATH: old/A.kt")
    expect(prompt).toContain("STATUS: MOVED")
    expect(prompt).toContain("+++ b/new/A.kt")
    expect(prompt).toContain(
      "3 dependency lock files changed; contents omitted",
    )
    expect(prompt).not.toContain("FILE: yarn.lock")
  })
})
