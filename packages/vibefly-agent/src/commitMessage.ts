/**
 * Single-shot conventional commit message generation via pi-ai stream.
 * Logs only via stderr (log.ts); never write to stdout.
 *
 * Model, language, and prompt config come from the RPC request + pi
 * ModelRegistry only (no commit env-var overrides).
 *
 * While the model is generating, optional [onProgress] keep-alives let the host
 * idle-timeout only when generation is truly silent (not mid-stream).
 */
import {
  type Api,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai"
import type {
  CommitFileChange,
  GenerateCommitMessageRequest,
  GenerateCommitMessageResult,
} from "./generated/controlRpc.js"
import { log } from "./log.js"

/** Min gap between progress callbacks during streaming (ms). */
export const COMMIT_PROGRESS_THROTTLE_MS = 2_000
/** Heartbeat while waiting for first stream event (ms). */
export const COMMIT_PROGRESS_HEARTBEAT_MS = 5_000

const SYSTEM_PROMPT = `You are an expert Git commit message generator that creates conventional commit messages based on staged changes. Analyze the provided git diff output and generate an appropriate conventional commit message following the specification.

## Conventional Commits Format
Generate commit messages following this exact structure:
\`\`\`
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
\`\`\`

### Core Types (Required)
- **feat**: New feature or functionality (MINOR version bump)
- **fix**: Bug fix or error correction (PATCH version bump)

### Additional Types (Extended)
- **docs**: Documentation changes only
- **style**: Code style changes (whitespace, formatting, semicolons, etc.)
- **refactor**: Code refactoring without feature changes or bug fixes
- **perf**: Performance improvements
- **test**: Adding or fixing tests
- **build**: Build system or external dependency changes
- **ci**: CI/CD configuration changes
- **chore**: Maintenance tasks, tooling changes
- **revert**: Reverting previous commits

### Scope Guidelines
- Use parentheses: \`feat(api):\`, \`fix(ui):\`
- Common scopes: \`api\`, \`ui\`, \`auth\`, \`db\`, \`config\`, \`deps\`, \`docs\`
- For monorepos: package or module names
- Keep scope concise and lowercase

### Description Rules
- Use imperative mood ("add" not "added" or "adds")
- Start with lowercase letter (for Latin scripts)
- No period at the end
- Maximum 72 characters
- Be concise but descriptive

### Body Guidelines (Optional)
- Start one blank line after description
- Explain the "what" and "why", not the "how"
- Wrap at 72 characters per line
- Use for complex changes requiring explanation
- Prefer a short body only when the change has multiple concerns

### Footer Guidelines (Optional)
- Start one blank line after body
- **Breaking Changes**: \`BREAKING CHANGE: description\`

## Input Format
Changes are provided as per-file blocks:
\`\`\`
FILE: path
STATUS: ADDED|MODIFIED|DELETED|MOVED
OLD_PATH: previous/path   (renames only)
STATS: +N -M
PATCH_STATUS: partial|omitted|lockfile|…  (omitted when full — the default)
<patch>
@@ -old,count +new,count @@
…unified hunks…
</patch>
END_FILE
\`\`\`
Lockfiles and sensitive paths may be summarized without patches.
When PATCH_STATUS is absent, the patch is complete (full).
When PATCH_STATUS is partial, some hunks were dropped to fit the model context budget.

## Analysis Instructions
When analyzing staged changes:
1. Determine Primary Type based on the nature of changes
2. Identify Scope from modified directories or modules
3. Craft Description focusing on the most significant change
4. Determine if there are Breaking Changes
5. For complex changes, include a detailed body explaining what and why
6. Add appropriate footers for issue references or breaking changes
7. When recent commit examples are provided, match their language, tone, length, and scope habits

## Output Rules
- Output ONLY the commit message text — no markdown fences, no quotes, no commentary
- Keep type and scope tokens in English (feat, fix, docs, …) even when the description language differs
- If PATCH_STATUS is partial/omitted, rely more on FILE, STATUS, and STATS
- For significant changes, include a detailed body explaining the changes
- Prefer matching the repo's recent commit style over generic examples when both apply`

/** Soft cap on how many per-file blocks are expanded in the user prompt. */
const MAX_PROMPT_FILE_BLOCKS = 100
/** Max recent commits used as few-shot style examples. */
const MAX_RECENT_MESSAGES = 5
/** Fraction of model context reserved for unified-diff hunks. */
export const DIFF_CONTEXT_RATIO = 0.6
/** Rough chars-per-token for code/diff budgeting without a real tokenizer. */
const CHARS_PER_TOKEN = 4
const DEFAULT_CONTEXT_WINDOW = 128_000
const TRUNCATION_MARKER = "...[truncated]...\n"

export type CommitPromptOptions = {
  /** Model context window in tokens (default 128000). */
  contextWindow?: number
  /** Max share of context used for diffs (default 0.6). */
  diffBudgetRatio?: number
}

/**
 * Resolve language from RPC request only (no env).
 * Prefer explicit `language`; fall back to style tokens like "conventional_zh".
 */
export function resolveCommitLanguage(
  language?: string | null,
  style?: string | null,
): string {
  const explicit = (language || "").trim()
  if (explicit) return normalizeLanguage(explicit)

  const raw = (style || "conventional_en").trim().toLowerCase()
  if (!raw) return "en"

  const afterUnderscore = raw.includes("_")
    ? raw.slice(raw.lastIndexOf("_") + 1)
    : raw
  return normalizeLanguage(afterUnderscore || "en")
}

function normalizeLanguage(code: string): string {
  const c = code.trim().toLowerCase().replace(/_/g, "-")
  if (!c || c === "en" || c.startsWith("en-")) return "en"
  if (c === "zh" || c.startsWith("zh-") || c === "cn" || c === "chinese") {
    return "zh"
  }
  return c
}

export function languageInstruction(language?: string): string {
  if (!language || language.toLowerCase() === "en") return ""
  const label =
    language === "zh"
      ? "Chinese (Simplified)"
      : language
  return (
    `\n\n## Language Requirement\n` +
    `CRITICAL: Write the commit description, body, and footers in ${label}. ` +
    `Keep Conventional Commit type and scope tokens in English ` +
    `(e.g. \`feat(api):\`, \`fix:\`). Do not translate type names.`
  )
}

export type SystemPromptOptions = {
  language?: string | null
  style?: string | null
  /** When non-empty, replaces the built-in Conventional Commits prompt. */
  customPrompt?: string | null
}

export function buildSystemPrompt(
  styleOrOptions?: string | SystemPromptOptions,
  maybeOptions?: SystemPromptOptions,
): string {
  const options: SystemPromptOptions =
    typeof styleOrOptions === "string" || styleOrOptions == null
      ? { style: styleOrOptions ?? undefined, ...(maybeOptions ?? {}) }
      : styleOrOptions
  const language = resolveCommitLanguage(options.language, options.style)
  const custom = (options.customPrompt || "").trim()
  const base = custom || SYSTEM_PROMPT
  return base + languageInstruction(language)
}

/** Character budget for all unified-diff hunks combined. */
export function diffCharBudget(
  contextWindow: number = DEFAULT_CONTEXT_WINDOW,
  ratio: number = DIFF_CONTEXT_RATIO,
): number {
  const r = Number.isFinite(ratio) && ratio > 0 ? Math.min(ratio, 1) : DIFF_CONTEXT_RATIO
  const cw =
    Number.isFinite(contextWindow) && contextWindow > 0
      ? contextWindow
      : DEFAULT_CONTEXT_WINDOW
  return Math.floor(cw * r * CHARS_PER_TOKEN)
}

type FileForPrompt = {
  path: string
  changeType: string
  oldPath?: string | null
  additions?: number
  deletions?: number
  hunks?: string[] | null
  omittedReason?: string | null
  /** Agent-side: some hunks dropped or shrunk to fit budget. */
  truncated?: boolean
}

export function buildUserPrompt(
  request: GenerateCommitMessageRequest,
  options?: CommitPromptOptions,
): string {
  const budget = diffCharBudget(
    options?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    options?.diffBudgetRatio ?? DIFF_CONTEXT_RATIO,
  )
  const files = fitFilesToDiffBudget(request.files ?? [], budget)

  const parts = [
    "Generate a conventional commit message for the following changes.",
    "Each file is a self-contained block (metadata + optional patch hunks).",
    "",
  ]

  const examples = formatRecentExamples(request.recentMessages)
  if (examples) {
    parts.push(examples, "")
  }

  const { expanded, summaries, skipped } = partitionForPrompt(files)
  for (const line of summaries) {
    parts.push(line)
  }
  if (summaries.length > 0) parts.push("")

  const anyIncomplete = files.some((f) => f.truncated || f.omittedReason)
  if (anyIncomplete) {
    parts.push(
      "Note: some patches are partial or omitted; use STATUS, STATS, and PATCH_STATUS when content is missing.",
      "",
    )
  }

  if (expanded.length === 0 && summaries.length === 0) {
    parts.push("(no files)")
    return parts.join("\n")
  }

  for (const f of expanded) {
    parts.push(formatFileBlock(f))
  }

  if (skipped > 0) {
    parts.push(
      `...and ${skipped} more files omitted from this prompt due to size limits.`,
    )
  }

  return parts.join("\n").trimEnd() + "\n"
}

/** Format recent repo commits as few-shot style anchors (newest first). */
export function formatRecentExamples(
  recentMessages?: string[] | null,
): string {
  if (!recentMessages?.length) return ""
  const cleaned: string[] = []
  const seen = new Set<string>()
  for (const raw of recentMessages) {
    const msg = (raw ?? "").replace(/\r\n/g, "\n").trim()
    if (!msg || seen.has(msg)) continue
    seen.add(msg)
    cleaned.push(msg)
    if (cleaned.length >= MAX_RECENT_MESSAGES) break
  }
  if (cleaned.length === 0) return ""

  const lines = [
    "## Recent commits in this repository (style examples)",
    "Match language, tone, subject length, and scope conventions of these examples.",
    "Do not copy them verbatim; write a new message for the current changes.",
    "",
  ]
  for (let i = 0; i < cleaned.length; i++) {
    lines.push(`EXAMPLE ${i + 1}:`)
    lines.push(cleaned[i]!)
    lines.push("")
  }
  return lines.join("\n").trimEnd()
}

/**
 * Fit full host-provided hunks into [maxChars], sampling evenly across files
 * and hunks so later changes remain visible when the diff must shrink.
 */
export function fitFilesToDiffBudget(
  files: CommitFileChange[],
  maxChars: number,
): FileForPrompt[] {
  if (files.length === 0) return []

  const normalized: FileForPrompt[] = files.map((f) => ({
    path: f.path,
    changeType: f.changeType,
    oldPath: f.oldPath,
    additions: f.additions,
    deletions: f.deletions,
    hunks: (f.hunks ?? []).filter((h) => typeof h === "string" && h.length > 0),
    omittedReason: f.omittedReason,
    truncated: false,
  }))

  const totalHunkChars = normalized.reduce(
    (sum, f) => sum + (f.hunks ?? []).reduce((s, h) => s + h.length, 0),
    0,
  )
  if (totalHunkChars <= maxChars) {
    return normalized
  }

  if (maxChars <= 0) {
    return normalized.map((f) => {
      if (!f.hunks?.length) return f
      return {
        ...f,
        hunks: [],
        truncated: true,
        omittedReason: f.omittedReason ?? "budget",
      }
    })
  }

  const weights = normalized.map((f) =>
    (f.hunks ?? []).reduce((s, h) => s + h.length, 0),
  )
  const quotas = fairQuotas(weights, maxChars)

  return normalized.map((f, i) => {
    const hunks = f.hunks ?? []
    if (hunks.length === 0) return f
    const q = quotas[i] ?? 0
    if (q <= 0) {
      return {
        ...f,
        hunks: [],
        truncated: true,
        omittedReason: f.omittedReason ?? "budget",
      }
    }
    const fitted = fitHunksToBudget(hunks, q)
    return {
      ...f,
      hunks: fitted.hunks,
      truncated: fitted.truncated,
      omittedReason:
        fitted.hunks.length === 0
          ? (f.omittedReason ?? "budget")
          : f.omittedReason,
    }
  })
}

/** Sample/shrink hunks to fit [maxChars]. Prefers keeping change lines over context. */
export function fitHunksToBudget(
  hunks: string[],
  maxChars: number,
): { hunks: string[]; truncated: boolean } {
  if (maxChars <= 0) {
    return { hunks: [], truncated: hunks.length > 0 }
  }
  const full = hunks.join("")
  if (full.length <= maxChars) {
    return { hunks: [...hunks], truncated: false }
  }

  const markerLen = TRUNCATION_MARKER.length
  const bodyBudget = Math.max(0, maxChars - markerLen)
  if (bodyBudget <= 0) {
    return { hunks: [sliceChars(TRUNCATION_MARKER, maxChars)], truncated: true }
  }

  const quotas = fairQuotas(
    hunks.map((h) => h.length),
    bodyBudget,
  )
  const parts: string[] = []
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i]!
    const q = quotas[i] ?? 0
    if (q <= 0) continue
    if (h.length <= q) {
      parts.push(h)
    } else {
      const cut = shrinkHunkText(h, q)
      if (cut) parts.push(cut)
    }
  }

  if (parts.length === 0 && hunks.length > 0) {
    const first = shrinkHunkText(hunks[0]!, bodyBudget)
    if (first) {
      return {
        hunks: [first + TRUNCATION_MARKER],
        truncated: true,
      }
    }
    return { hunks: [], truncated: true }
  }

  return {
    hunks: [...parts, TRUNCATION_MARKER],
    truncated: true,
  }
}

/**
 * Drop context (' ') body lines first, then hard-slice if still over budget.
 * Keeps the @@ header line when present.
 */
export function shrinkHunkText(hunk: string, maxChars: number): string {
  if (maxChars <= 0) return ""
  if (hunk.length <= maxChars) return hunk

  const normalized = hunk.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")
  // Drop trailing empty from final newline so we can re-join cleanly.
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop()
  }
  if (lines.length === 0) return sliceChars(hunk, maxChars)

  const header = lines[0]!.startsWith("@@") ? lines[0]! : null
  const body = header != null ? lines.slice(1) : lines
  const changeLines = body.filter(
    (l) => l.startsWith("-") || l.startsWith("+"),
  )
  const slimLines =
    header != null ? [header, ...changeLines] : changeLines
  const slim =
    slimLines.length > 0 ? slimLines.join("\n") + "\n" : ""

  if (slim && slim.length <= maxChars) return slim
  if (slim) return sliceChars(slim, maxChars)
  return sliceChars(hunk, maxChars)
}

/**
 * Distribute [totalBudget] across items with given [weights], sharing by weight.
 */
export function fairQuotas(weights: number[], totalBudget: number): number[] {
  const n = weights.length
  if (n === 0) return []
  if (totalBudget <= 0) return Array(n).fill(0)

  const quotas = Array(n).fill(0) as number[]
  const active = weights
    .map((w, i) => (w > 0 ? i : -1))
    .filter((i) => i >= 0)
  if (active.length === 0) return quotas

  const weightSum = active.reduce((s, i) => s + weights[i]!, 0)
  let assigned = 0
  for (let idx = 0; idx < active.length; idx++) {
    const i = active[idx]!
    const share =
      idx === active.length - 1
        ? totalBudget - assigned
        : Math.floor((totalBudget * weights[i]!) / weightSum)
    quotas[i] = Math.max(0, share)
    assigned += Math.max(0, share)
  }

  // Cap each quota by content size.
  for (let i = 0; i < n; i++) {
    if (weights[i]! > 0) {
      quotas[i] = Math.min(quotas[i]!, weights[i]!)
    }
  }

  // Redistribute leftover from caps.
  let leftover = totalBudget - quotas.reduce((a, b) => a + b, 0)
  let guard = 0
  while (leftover > 0 && guard < n * 4) {
    let progressed = false
    for (const i of active) {
      if (leftover <= 0) break
      if (quotas[i]! < weights[i]!) {
        quotas[i]!++
        leftover--
        progressed = true
      }
    }
    if (!progressed) break
    guard++
  }
  return quotas
}

function sliceChars(text: string, maxChars: number): string {
  if (maxChars <= 0) return ""
  if (text.length <= maxChars) return text
  // Avoid splitting surrogate pairs.
  let end = maxChars
  if (
    end > 0 &&
    end < text.length &&
    text.charCodeAt(end - 1) >= 0xd800 &&
    text.charCodeAt(end - 1) <= 0xdbff
  ) {
    end--
  }
  return text.slice(0, end)
}

function partitionForPrompt(files: FileForPrompt[]): {
  expanded: FileForPrompt[]
  summaries: string[]
  skipped: number
} {
  const summaries: string[] = []
  const lockfiles = files.filter((f) => f.omittedReason === "lockfile")
  const sensitive = files.filter((f) => f.omittedReason === "sensitive")

  if (lockfiles.length >= 2) {
    summaries.push(
      `${lockfiles.length} dependency lock files changed; contents omitted`,
    )
  }
  if (sensitive.length >= 2) {
    summaries.push(
      `${sensitive.length} sensitive files changed; contents omitted`,
    )
  }

  const rest = files.filter((f) => {
    if (f.omittedReason === "lockfile" && lockfiles.length >= 2) return false
    if (f.omittedReason === "sensitive" && sensitive.length >= 2) return false
    return true
  })

  const ranked = [...rest].sort((a, b) => {
    const score = (f: FileForPrompt) => {
      if (f.hunks?.length) return 0
      if (f.omittedReason === "budget" || f.truncated) return 1
      if (f.omittedReason) return 2
      return 1
    }
    return score(a) - score(b)
  })

  const expanded = ranked.slice(0, MAX_PROMPT_FILE_BLOCKS)
  const skipped = Math.max(0, ranked.length - expanded.length)
  return { expanded, summaries, skipped }
}

function patchStatusOf(f: FileForPrompt): string {
  if (f.omittedReason) {
    if (f.omittedReason === "budget") return "omitted"
    if (f.truncated && f.hunks?.length) return `partial (${f.omittedReason})`
    return f.omittedReason
  }
  if (f.truncated) return "partial"
  if (f.hunks?.length) return "full"
  return "none"
}

function formatFileBlock(f: FileForPrompt): string {
  const lines = [
    `FILE: ${f.path}`,
    `STATUS: ${f.changeType}`,
  ]
  if (f.oldPath) lines.push(`OLD_PATH: ${f.oldPath}`)
  if ((f.additions ?? 0) > 0 || (f.deletions ?? 0) > 0) {
    lines.push(`STATS: +${f.additions ?? 0} -${f.deletions ?? 0}`)
  }
  const patchStatus = patchStatusOf(f)
  if (patchStatus !== "full") {
    lines.push(`PATCH_STATUS: ${patchStatus}`)
  }
  const hunks = f.hunks ?? []
  if (hunks.length > 0) {
    lines.push("<patch>")
    const body = hunks.join("").replace(/\n$/, "")
    lines.push(body)
    lines.push("</patch>")
  }
  lines.push("END_FILE", "")
  return lines.join("\n")
}

/** Pure helper: strip fences/quotes and clamp subject length. */
export function sanitizeCommitMessage(raw: string): string {
  let text = raw.trim()
  if (!text) return ""

  const fence = /^```(?:[a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)\n?```$/
  const fenced = text.match(fence)
  if (fenced?.[1] != null) {
    text = fenced[1].trim()
  } else if (text.startsWith("```")) {
    text = text
      .replace(/^```(?:[a-zA-Z0-9_-]+)?\s*\n?/, "")
      .replace(/\n?```\s*$/, "")
      .trim()
  }

  // Drop a leading label some models add: "Commit message:" / "提交信息："
  text = text
    .replace(/^(?:commit\s*message|提交信息|提交说明)\s*[:：]\s*/i, "")
    .trim()

  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim()
  }

  const lines = text.split(/\r?\n/)
  const subject = (lines[0] ?? "").trim()
  if (!subject) return ""

  const body = lines
    .slice(1)
    .join("\n")
    .replace(/^\n+/, "")
    .trimEnd()
  // Keep body modest to avoid pasting essays into the commit box.
  const clampedBody =
    body.length > 2000 ? `${body.slice(0, 1997).trimEnd()}...` : body

  return clampedBody ? `${subject}\n\n${clampedBody}` : subject
}

export function parseModelSpec(
  spec: string,
): { provider: string; modelId: string } | null {
  const trimmed = spec.trim()
  if (!trimmed) return null
  const slash = trimmed.indexOf("/")
  const colon = trimmed.indexOf(":")
  let sep = -1
  if (slash > 0) sep = slash
  else if (colon > 0) sep = colon
  if (sep <= 0) return null
  const provider = trimmed.slice(0, sep).trim()
  const modelId = trimmed.slice(sep + 1).trim()
  if (!provider || !modelId) return null
  return { provider, modelId }
}

/** Build a non-catalog model (tests / rare local fixtures). Not used for env fallback. */
export function buildCustomCommitModel(
  provider: string,
  modelId: string,
  options?: { api?: Api; baseUrl?: string },
): Model<Api> {
  const api = options?.api ?? ("openai-responses" as Api)
  const baseUrl = options?.baseUrl ?? "https://api.openai.com/v1"
  return {
    id: modelId,
    name: modelId,
    api,
    provider,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  } as Model<Api>
}

export type ResolveCommitModelInput = {
  /** Commit-specific model (`provider/modelId`). Empty = use defaultModel. */
  commitModel?: string | null
  /** Providers default model (`provider/modelId`). */
  defaultModel?: string | null
}

/**
 * Resolve model from RPC request + pi ModelRegistry only.
 *
 * Priority:
 * 1. request.commitModel
 * 2. request.defaultModel
 * 3. error — no available commit model
 *
 * API key / base URL / API type come only from pi models.json + auth.json.
 * Commit-related env vars are ignored.
 */
export async function resolveCommitModel(
  input: ResolveCommitModelInput = {},
): Promise<{
  model: Model<Api>
  apiKey?: string
}> {
  const commitModel = (input.commitModel || "").trim()
  const defaultModel = (input.defaultModel || "").trim()
  const selected = commitModel || defaultModel

  if (!selected) {
    throw new Error(
      "No commit model configured. " +
        "Set a default model in Settings > Vibe Fly > Providers, " +
        "or choose a commit model in Settings > Vibe Fly > Commit Message.",
    )
  }

  const parsed = parseModelSpec(selected)
  if (!parsed) {
    throw new Error(
      `Invalid model "${selected}". Use provider/modelId (e.g. openai/gpt-4o-mini).`,
    )
  }

  const { getPiRuntime } = await import("./piRuntime.js")
  const runtime = await getPiRuntime()
  const { registry } = runtime

  const model = registry.find(parsed.provider, parsed.modelId)
  if (!model) {
    const loadError = registry.getError()
    const loadHint = loadError ? ` Config load error: ${loadError}` : ""
    throw new Error(
      `Model "${selected}" was not found in pi config (models.json).` +
        loadHint +
        ` Configure it in Settings > Vibe Fly > Providers.`,
    )
  }

  const auth = await runtime.modelRuntime.getAuth(model)
  if (!auth) {
    throw new Error(
      `No credentials for provider "${model.provider}". ` +
        `Configure it in Settings > Vibe Fly > Providers.`,
    )
  }

  return { model, apiKey: auth.auth.apiKey }
}

function extractText(response: { content: Array<{ type: string; text?: string }> }): string {
  const parts: string[] = []
  for (const block of response.content) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text)
    }
  }
  return parts.join("").trim()
}

function contentLength(content: unknown): number {
  if (typeof content === "string") return content.length
  if (Array.isArray(content)) {
    return content.reduce((sum, part) => {
      if (typeof part === "string") return sum + part.length
      if (part && typeof part === "object" && "text" in part) {
        return sum + String((part as { text?: unknown }).text ?? "").length
      }
      return sum + JSON.stringify(part).length
    }, 0)
  }
  if (content == null) return 0
  return String(content).length
}

function formatContent(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "")
        }
        return JSON.stringify(part, null, 2)
      })
      .join("\n")
  }
  if (content == null) return ""
  return String(content)
}

/** Full multi-line dump of the LLM context (debug level only). */
function logCommitContext(context: Context): void {
  const systemText = context.systemPrompt ?? ""
  const messages = context.messages ?? []

  const messageStats = messages.map((m, i) => {
    const len = contentLength(m.content)
    return `#${i + 1} ${m.role} ${len} chars`
  })

  log.info("generateCommitMessage context", {
    systemPromptChars: systemText.length,
    messages: messages.length,
    messageStats: messageStats.length ? messageStats.join("; ") : undefined,
  })

  const divider = "─".repeat(60)
  log.debug(divider)
  log.debug(`[systemPrompt] ${systemText.length} chars`)
  log.debug(systemText || "(empty)")
  log.debug(divider)

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!
    const text = formatContent(m.content)
    log.debug(
      `[message ${i + 1}/${messages.length}] role=${m.role} chars=${text.length}`,
    )
    log.debug(text || "(empty)")
    log.debug(divider)
  }
}

export type GenerateCommitMessageOptions = {
  /** Keep-alive / status for host idle timeout. Best-effort; failures ignored. */
  onProgress?: (message: string) => void | Promise<void>
  /** Abort when host cancels the RPC. */
  signal?: AbortSignal
}

/**
 * Prefer no reasoning for cheap commit-message calls.
 * Some OpenRouter endpoints reject `reasoning: { enabled: false }` ("Reasoning
 * is mandatory…"), so fall back to the lowest supported effort instead.
 */
export function commitStreamOptions(
  _model: Model<Api>,
  options: Pick<GenerateCommitMessageOptions, "signal"> & { apiKey?: string },
): SimpleStreamOptions {
  return {
    apiKey: options.apiKey,
    signal: options.signal,
  }
}

export async function generateCommitMessage(
  request: GenerateCommitMessageRequest,
  options: GenerateCommitMessageOptions = {},
): Promise<GenerateCommitMessageResult> {
  if (!request.files.length) {
    throw new Error("No changes to describe")
  }

  const { onProgress, signal } = options
  const report = (message: string) => {
    if (!onProgress) return
    void Promise.resolve(onProgress(message)).catch(() => {})
  }

  report("Resolving model…")
  const { model, apiKey } = await resolveCommitModel({
    commitModel: request.commitModel,
    defaultModel: request.defaultModel,
  })
  if (signal?.aborted) {
    log.info("generateCommitMessage cancelled before model call")
    throw new Error("Commit message generation cancelled")
  }

  const language = resolveCommitLanguage(request.language, request.style)
  const contextWindow =
    typeof model.contextWindow === "number" && model.contextWindow > 0
      ? model.contextWindow
      : DEFAULT_CONTEXT_WINDOW
  log.info("generateCommitMessage model", {
    model: `${model.provider}/${model.id}`,
    lang: language,
    ctx: contextWindow,
    diffBudget: `${diffCharBudget(contextWindow)}chars`,
  })

  report("Building prompt…")
  const context: Context = {
    systemPrompt: buildSystemPrompt({
      language,
      style: request.style,
      customPrompt: request.customPrompt,
    }),
    messages: [
      {
        role: "user",
        content: buildUserPrompt(request, { contextWindow }),
        timestamp: Date.now(),
      },
    ],
  }

  // Full prompt dump only when VIBEFLY_LOG_LEVEL=debug (or lower).
  logCommitContext(context)

  report("Calling model…")
  const { getPiRuntime } = await import("./piRuntime.js")
  const runtime = await getPiRuntime()
  const stream = runtime.modelRuntime.streamSimple(
    model,
    context,
    commitStreamOptions(model, { apiKey, signal }),
  )

  let lastProgressAt = 0
  let sawStreamEvent = false
  let heartbeat: ReturnType<typeof setInterval> | null = setInterval(() => {
    if (sawStreamEvent) return
    report("Waiting for model…")
  }, COMMIT_PROGRESS_HEARTBEAT_MS)

  const clearHeartbeat = () => {
    if (heartbeat != null) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }

  try {
    for await (const event of stream) {
      if (signal?.aborted) {
        log.info("generateCommitMessage cancelled during stream")
        throw new Error("Commit message generation cancelled")
      }
      sawStreamEvent = true
      clearHeartbeat()
      const now = Date.now()
      if (now - lastProgressAt >= COMMIT_PROGRESS_THROTTLE_MS) {
        lastProgressAt = now
        switch (event.type) {
          case "start":
            report("Model started…")
            break
          case "text_delta":
          case "text_start":
          case "text_end":
            report("Generating message…")
            break
          case "thinking_delta":
          case "thinking_start":
          case "thinking_end":
            report("Model thinking…")
            break
          case "done":
            report("Finalizing…")
            break
          case "error":
            break
          default:
            report("Generating…")
            break
        }
      }
    }
  } finally {
    clearHeartbeat()
  }

  const response = await stream.result()
  if (response.errorMessage) {
    throw new Error(response.errorMessage)
  }

  const message = sanitizeCommitMessage(extractText(response))
  if (!message) {
    throw new Error("Model returned an empty commit message")
  }
  return { message }
}
