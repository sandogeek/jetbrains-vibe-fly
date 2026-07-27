import { describe, expect, test } from "bun:test"
import {
  buildCustomCommitModel,
  buildSystemPrompt,
  buildUserPrompt,
  commitStreamOptions,
  diffCharBudget,
  DIFF_CONTEXT_RATIO,
  fairQuotas,
  fitHunksToBudget,
  formatRecentExamples,
  languageInstruction,
  resolveCommitLanguage,
  sanitizeCommitMessage,
  shrinkHunkText,
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
    expect(resolveCommitLanguage(undefined, "conventional_en")).toBe("en")
  })

  test("prefers explicit language over style", () => {
    expect(resolveCommitLanguage("zh", "conventional_en")).toBe("zh")
    expect(resolveCommitLanguage("en", "conventional_zh")).toBe("en")
  })

  test("parses zh styles when language omitted", () => {
    expect(resolveCommitLanguage(undefined, "conventional_zh")).toBe("zh")
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

  test("custom prompt replaces built-in and keeps language constraint", () => {
    const prompt = buildSystemPrompt({
      language: "zh",
      customPrompt: "You write tiny commit subjects only.",
    })
    expect(prompt).toContain("You write tiny commit subjects only.")
    expect(prompt).not.toContain("Conventional Commits Format")
    expect(prompt).toContain("Language Requirement")
    expect(prompt).toContain("Chinese")
  })

  test("empty custom prompt keeps built-in", () => {
    const prompt = buildSystemPrompt({
      language: "en",
      customPrompt: "   ",
    })
    expect(prompt).toContain("Conventional Commits")
    expect(prompt).not.toContain("Language Requirement")
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

describe("commitStreamOptions", () => {
  test("disables reasoning for non-reasoning models", () => {
    const model = buildCustomCommitModel("openai", "gpt-test")
    expect(model.reasoning).toBe(false)
    expect(commitStreamOptions(model, { apiKey: "k" })).toEqual({
      apiKey: "k",
      signal: undefined,
      disableReasoning: true,
    })
  })

  test("floors reasoning models to lowest supported effort", () => {
    const model = {
      ...buildCustomCommitModel("openrouter", "openai/gpt-oss-20b:free", {
        api: "openrouter" as never,
        baseUrl: "https://openrouter.ai/api/v1",
      }),
      reasoning: true,
      thinking: {
        mode: "effort" as const,
        efforts: ["low", "medium", "high"] as const,
      },
    }
    expect(commitStreamOptions(model, { apiKey: "k" })).toEqual({
      apiKey: "k",
      signal: undefined,
      reasoning: "low",
    })
  })

  test("omits disable for reasoning models without efforts", () => {
    const model = {
      ...buildCustomCommitModel("openrouter", "openai/gpt-oss-20b:free", {
        api: "openrouter" as never,
        baseUrl: "https://openrouter.ai/api/v1",
      }),
      reasoning: true,
    }
    expect(commitStreamOptions(model, { apiKey: "k" })).toEqual({
      apiKey: "k",
      signal: undefined,
    })
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

describe("diffCharBudget", () => {
  test("defaults to 60% of context as chars", () => {
    expect(DIFF_CONTEXT_RATIO).toBe(0.6)
    // 1000 tokens * 0.6 * 4 chars/token
    expect(diffCharBudget(1000)).toBe(2400)
    expect(diffCharBudget(1000, 0.5)).toBe(2000)
  })
})

describe("fairQuotas", () => {
  test("gives every non-zero weight a share", () => {
    const quotas = fairQuotas([50_000, 50_000, 50_000], 3000)
    expect(quotas).toHaveLength(3)
    expect(quotas.every((q) => q > 0)).toBe(true)
    expect(quotas.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3000)
  })
})

describe("fitHunksToBudget", () => {
  test("keeps all hunks when under budget", () => {
    const hunks = ["@@ -1 +1 @@\n-a\n+b\n"]
    const fitted = fitHunksToBudget(hunks, 10_000)
    expect(fitted.truncated).toBe(false)
    expect(fitted.hunks).toEqual(hunks)
  })

  test("samples multiple hunks not only head", () => {
    function makeHunk(marker: string): string {
      const ctx = Array.from({ length: 30 }, (_, i) => ` pad-${i}`).join("\n")
      return `@@ -1,62 +1,62 @@\n${ctx}\n-old-${marker}\n+${marker}\n${ctx}\n`
    }
    const hunks = [makeHunk("HEAD_A"), makeHunk("MID_B"), makeHunk("TAIL_C")]
    const full = hunks.join("").length
    const budget = Math.max(200, Math.floor(full * 0.4))
    const fitted = fitHunksToBudget(hunks, budget)
    expect(fitted.truncated).toBe(true)
    const text = fitted.hunks.join("")
    const markers = ["HEAD_A", "MID_B", "TAIL_C"].filter((m) => text.includes(m))
    expect(markers.length).toBeGreaterThanOrEqual(2)
  })
})

describe("shrinkHunkText", () => {
  test("drops context lines before change lines", () => {
    const hunk =
      "@@ -10,5 +10,5 @@\n ctx-a\n ctx-b\n-old\n+new\n ctx-c\n"
    // Full hunk is longer than this; change-only form still fits.
    const slim = shrinkHunkText(hunk, 40)
    expect(slim).toContain("@@")
    expect(slim).toContain("-old")
    expect(slim).toContain("+new")
    expect(slim).not.toContain("ctx-a")
  })
})

describe("buildUserPrompt", () => {
  test("emits per-file blocks with metadata and hunks", () => {
    const prompt = buildUserPrompt({
      files: [
        {
          path: "a.kt",
          changeType: "MODIFIED",
          additions: 2,
          deletions: 1,
          hunks: ["@@ -1,2 +1,3 @@\n-a\n+x\n"],
        },
        { path: "b.ts", changeType: "ADDED", additions: 5, deletions: 0 },
      ],
    })
    expect(prompt).toContain("FILE: a.kt")
    expect(prompt).toContain("STATUS: MODIFIED")
    expect(prompt).toContain("STATS: +2 -1")
    expect(prompt).not.toContain("PATCH_STATUS: full")
    expect(prompt).toContain("<patch>")
    expect(prompt).toContain("@@ -1,2 +1,3 @@")
    expect(prompt).toContain("+x")
    expect(prompt).toContain("</patch>")
    expect(prompt).toContain("END_FILE")
    expect(prompt).toContain("FILE: b.ts")
    expect(prompt).toContain("STATUS: ADDED")
    expect(prompt).toContain("STATS: +5 -0")
  })

  test("marks partial when budget forces truncation", () => {
    const bigHunk =
      "@@ -1,100 +1,100 @@\n" +
      Array.from({ length: 200 }, (_, i) => `+line-${i}-padding`).join("\n") +
      "\n"
    const prompt = buildUserPrompt(
      {
        files: [
          {
            path: "big.kt",
            changeType: "MODIFIED",
            additions: 200,
            hunks: [bigHunk],
          },
        ],
      },
      { contextWindow: 50, diffBudgetRatio: 0.6 },
    )
    expect(prompt).toContain("PATCH_STATUS: partial")
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
          hunks: ["@@ -1 +1 @@\n-x\n+y\n"],
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
    expect(prompt).toContain("+y")
    expect(prompt).toContain(
      "3 dependency lock files changed; contents omitted",
    )
    expect(prompt).not.toContain("FILE: yarn.lock")
  })
})
