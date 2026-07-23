/**
 * Single-shot conventional commit message generation via pi-ai complete.
 * Logs only via stderr (log.ts); never write to stdout.
 */
import {
  completeSimple,
  getEnvApiKey,
  type Api,
  type Context,
  type Model,
} from "@oh-my-pi/pi-ai"
import { buildModel } from "@oh-my-pi/pi-catalog/build"
import {
  getBundledModel,
  getBundledModels,
  getBundledProviders,
  type GeneratedProvider,
} from "@oh-my-pi/pi-catalog/models"
import type { ModelSpec } from "@oh-my-pi/pi-catalog/types"
import type {
  GenerateCommitMessageRequest,
  GenerateCommitMessageResult,
} from "./generated/controlRpc.js"
import { log } from "./log.js"

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
PATCH_STATUS: full|partial|omitted|lockfile|…
<patch>
…unified diff…
</patch>
END_FILE
\`\`\`
Lockfiles and sensitive paths may be summarized without patches.

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

const DEFAULT_CUSTOM_API: Api = "openai-responses"
const DEFAULT_CUSTOM_BASE_URL = "https://api.openai.com/v1"

/** Parse style like "conventional_en", "conventional_zh", "en", "zh-CN". */
export function resolveCommitLanguage(style?: string): string {
  const env = (process.env.VIBEFLY_COMMIT_LANGUAGE || "").trim()
  if (env) return normalizeLanguage(env)

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

export function buildSystemPrompt(style?: string): string {
  const language = resolveCommitLanguage(style)
  return SYSTEM_PROMPT + languageInstruction(language)
}

/** Soft cap on how many per-file blocks are expanded in the user prompt. */
const MAX_PROMPT_FILE_BLOCKS = 80
/** Max recent commits used as few-shot style examples. */
const MAX_RECENT_MESSAGES = 10

export function buildUserPrompt(request: GenerateCommitMessageRequest): string {
  const files = request.files
  const parts = [
    "Generate a conventional commit message for the following changes.",
    "Each file is a self-contained block (metadata + optional patch).",
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

function partitionForPrompt(files: Array<{
  path: string
  changeType: string
  oldPath?: string | null
  additions?: number
  deletions?: number
  diff?: string | null
  truncated?: boolean
  omittedReason?: string | null
}>): {
  expanded: typeof files
  summaries: string[]
  skipped: number
} {
  const summaries: string[] = []
  const lockfiles = files.filter((f) => f.omittedReason === "lockfile")
  const sensitive = files.filter((f) => f.omittedReason === "sensitive")

  // Prefer host-side collapse, but still aggregate if many individual rows remain.
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

  // Prefer files that still carry a patch; keep omitted-but-named rows early.
  const ranked = [...rest].sort((a, b) => {
    const score = (f: (typeof files)[number]) => {
      if (f.diff) return 0
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

function patchStatusOf(f: {
  diff?: string | null
  truncated?: boolean
  omittedReason?: string | null
}): string {
  if (f.omittedReason) {
    if (f.omittedReason === "budget") return "omitted"
    if (f.truncated && f.diff) return `partial (${f.omittedReason})`
    return f.omittedReason
  }
  if (f.truncated) return "partial"
  if (f.diff) return "full"
  return "none"
}

function formatFileBlock(f: {
  path: string
  changeType: string
  oldPath?: string | null
  additions?: number
  deletions?: number
  diff?: string | null
  truncated?: boolean
  omittedReason?: string | null
}): string {
  const lines = [
    `FILE: ${f.path}`,
    `STATUS: ${f.changeType}`,
  ]
  if (f.oldPath) lines.push(`OLD_PATH: ${f.oldPath}`)
  if ((f.additions ?? 0) > 0 || (f.deletions ?? 0) > 0) {
    lines.push(`STATS: +${f.additions ?? 0} -${f.deletions ?? 0}`)
  }
  lines.push(`PATCH_STATUS: ${patchStatusOf(f)}`)
  if (typeof f.diff === "string" && f.diff.length > 0) {
    lines.push("<patch>")
    lines.push(f.diff.replace(/\n$/, ""))
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

function parseModelSpec(spec: string): { provider: string; modelId: string } | null {
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

function tryBundled(
  provider: string,
  modelId: string,
): Model<Api> | undefined {
  try {
    const model = getBundledModel(provider as GeneratedProvider, modelId) as
      | Model<Api>
      | undefined
    if (!model?.id || !model.provider) return undefined
    return model
  } catch {
    return undefined
  }
}

function readCommitEnv(name: string): string {
  return (process.env[name] || "").trim()
}

function resolveCommitApiKey(provider: string): string | undefined {
  return (
    readCommitEnv("VIBEFLY_COMMIT_API_KEY") ||
    getEnvApiKey(provider) ||
    readCommitEnv("OPENAI_API_KEY") ||
    undefined
  )
}

function resolveCommitApi(fallback?: Api): Api {
  const raw = readCommitEnv("VIBEFLY_COMMIT_API")
  if (raw) return raw as Api
  return fallback ?? DEFAULT_CUSTOM_API
}

function resolveCommitBaseUrl(fallback?: string): string {
  return (
    readCommitEnv("VIBEFLY_COMMIT_BASE_URL") ||
    readCommitEnv("OPENAI_BASE_URL") ||
    fallback ||
    DEFAULT_CUSTOM_BASE_URL
  )
}

/** Build a non-catalog model (custom base URL / API / model id). */
export function buildCustomCommitModel(
  provider: string,
  modelId: string,
  options?: { api?: Api; baseUrl?: string },
): Model<Api> {
  const api = options?.api ?? DEFAULT_CUSTOM_API
  const baseUrl = options?.baseUrl ?? DEFAULT_CUSTOM_BASE_URL
  const spec: ModelSpec<Api> = {
    id: modelId,
    name: modelId,
    api,
    provider: provider as ModelSpec<Api>["provider"],
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  }
  return buildModel(spec)
}

function applyModelOverrides(
  model: Model<Api>,
  overrides: { api?: Api; baseUrl?: string },
): Model<Api> {
  const api = overrides.api
  const baseUrl = overrides.baseUrl
  if (!api && !baseUrl) return model
  if (api === model.api && (!baseUrl || baseUrl === model.baseUrl)) return model
  return buildModel({
    ...model,
    api: api ?? model.api,
    baseUrl: baseUrl ?? model.baseUrl,
    compat: model.compatConfig,
  } as ModelSpec<Api>)
}

/**
 * Resolve model from env / bundled catalog + env API keys.
 *
 * Env:
 * - VIBEFLY_COMMIT_MODEL / OMP_COMMIT_MODEL: "provider/modelId" or "provider:modelId"
 * - VIBEFLY_COMMIT_API: wire API (default openai-responses for custom models)
 * - VIBEFLY_COMMIT_BASE_URL / OPENAI_BASE_URL: custom endpoint
 * - VIBEFLY_COMMIT_API_KEY / provider env key / OPENAI_API_KEY
 */
export function resolveCommitModel(): {
  model: Model<Api>
  apiKey: string
} {
  const override = (
    process.env.VIBEFLY_COMMIT_MODEL ||
    process.env.OMP_COMMIT_MODEL ||
    ""
  ).trim()

  const apiEnv = readCommitEnv("VIBEFLY_COMMIT_API")
  const baseUrlEnv =
    readCommitEnv("VIBEFLY_COMMIT_BASE_URL") || readCommitEnv("OPENAI_BASE_URL")

  if (override) {
    const parsed = parseModelSpec(override)
    if (!parsed) {
      throw new Error(
        `Invalid VIBEFLY_COMMIT_MODEL "${override}". Use provider/modelId (e.g. openai/gpt-4o-mini).`,
      )
    }

    let model = tryBundled(parsed.provider, parsed.modelId)
    if (model) {
      model = applyModelOverrides(model, {
        api: apiEnv ? (apiEnv as Api) : undefined,
        baseUrl: baseUrlEnv || undefined,
      })
    } else {
      model = buildCustomCommitModel(parsed.provider, parsed.modelId, {
        api: resolveCommitApi(),
        baseUrl: resolveCommitBaseUrl(),
      })
    }

    const apiKey = resolveCommitApiKey(String(model.provider))
    if (!apiKey) {
      throw new Error(
        `No API key for provider "${model.provider}". Set VIBEFLY_COMMIT_API_KEY, ` +
          `the provider env key (e.g. OPENAI_API_KEY), or configure omp auth.`,
      )
    }
    return { model, apiKey }
  }

  // Any provider with an env key and at least one bundled model.
  for (const provider of getBundledProviders()) {
    const providerId = String(provider)
    const apiKey = resolveCommitApiKey(providerId)
    if (!apiKey) continue
    const models = getBundledModels(provider as GeneratedProvider) as Model<Api>[]
    let model = models[0]
    if (!model) continue
    model = applyModelOverrides(model, {
      api: apiEnv ? (apiEnv as Api) : undefined,
      baseUrl: baseUrlEnv || undefined,
    })
    return { model, apiKey }
  }

  throw new Error(
    "No model/API key available for commit message generation. " +
      "Set VIBEFLY_COMMIT_MODEL=provider/modelId (catalog or custom), " +
      "optional VIBEFLY_COMMIT_API / VIBEFLY_COMMIT_BASE_URL, and an API key " +
      "(VIBEFLY_COMMIT_API_KEY or e.g. OPENAI_API_KEY).",
  )
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

function isCommitDebug(): boolean {
  const raw = (
    process.env.VIBEFLY_COMMIT_DEBUG ||
    process.env.VIBEFLY_DEBUG ||
    ""
  )
    .trim()
    .toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes"
}

export async function generateCommitMessage(
  request: GenerateCommitMessageRequest,
): Promise<GenerateCommitMessageResult> {
  if (!request.files.length) {
    throw new Error("No changes to describe")
  }

  const { model, apiKey } = resolveCommitModel()
  const language = resolveCommitLanguage(request.style)
  log(
    "generateCommitMessage model",
    `${model.provider}/${model.id}`,
    `lang=${language}`,
  )

  const context: Context = {
    systemPrompt: [buildSystemPrompt(request.style)],
    messages: [
      {
        role: "user",
        content: buildUserPrompt(request),
        timestamp: Date.now(),
      },
    ],
  }

  if (isCommitDebug()) {
    log(
      "generateCommitMessage context",
      JSON.stringify(
        {
          systemPrompt: context.systemPrompt,
          messages: context.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        },
        null,
        2,
      ),
    )
  }

  const response = await completeSimple(model, context, {
    apiKey,
    disableReasoning: true,
  })
  if (response.errorMessage) {
    throw new Error(response.errorMessage)
  }

  const message = sanitizeCommitMessage(extractText(response))
  if (!message) {
    throw new Error("Model returned an empty commit message")
  }
  return { message }
}
