/**
 * Pi / Vibe Fly 文档 shape 与 managed-field 元数据的单一声明源。
 * 用非破坏性 tagged rule 包装现有 SchemaRule：校验与 InferRule 仍看内层规则。
 */
import {type JsonValue} from "../json.js"
import {
    arrayRule,
    type ArrayRule,
    BOOLEAN_RULE,
    enumRule,
    type InferRule,
    NON_NEGATIVE_NUMBER_RULE,
    objectRule,
    optional,
    required,
    type SchemaRule,
    type SchemaShape,
    type StrictShape,
    STRING_ARRAY_RULE,
    STRING_ARRAY_VALUE_RULE,
    STRING_RULE,
    strictObjectRule,
    unionRule,
    valueRule,
    type ValueRule,
} from "../json-schema.js"

export type SettingReadLayer = "effective" | "application"

export type ManagedFieldMeta<T> = {
    readonly readLayer: SettingReadLayer
    readonly scopes: readonly ("application" | "project")[]
    readonly fallback: T
    readonly encode?: (value: T) => JsonValue
}

/** 在现有 SchemaRule 上挂元数据；kind / 校验行为不变。 */
export type TaggedRule<TValue = unknown, TRule extends SchemaRule = SchemaRule> = TRule & {
    readonly __managed: ManagedFieldMeta<TValue>
}

/** 只给叶子 rule 打 tag，避免 InferRule<SchemaRule> 无限展开。 */
type ManagedLeafRule = ValueRule<any> | ArrayRule<ValueRule<any>>

const EFFECTIVE_SCOPES = Object.freeze(["application", "project"] as const)
const APPLICATION_SCOPES = Object.freeze(["application"] as const)

/** 稳定空数组 fallback，pin / MRU 缺失或整表 reject 时复用同一引用。 */
const EMPTY_STRING_ARRAY: string[] = Object.freeze([]) as unknown as string[]

export function tagged<const TRule extends ManagedLeafRule>(
    rule: TRule,
    meta: ManagedFieldMeta<InferRule<TRule>>,
): TaggedRule<InferRule<TRule>, TRule> {
    return Object.freeze({
        ...rule,
        __managed: Object.freeze({
            readLayer: meta.readLayer,
            scopes: Object.freeze([...meta.scopes]),
            fallback: meta.fallback,
            ...(meta.encode ? {encode: meta.encode} : {}),
        }),
    }) as unknown as TaggedRule<InferRule<TRule>, TRule>
}

export function isTaggedRule(rule: SchemaRule): rule is TaggedRule {
    return Object.prototype.hasOwnProperty.call(rule, "__managed")
}

function effective<const TRule extends ManagedLeafRule>(
    rule: TRule,
    fallback: InferRule<TRule>,
    encode?: (value: InferRule<TRule>) => JsonValue,
): TaggedRule<InferRule<TRule>, TRule> {
    return tagged(rule, {
        readLayer: "effective",
        scopes: EFFECTIVE_SCOPES,
        fallback,
        encode,
    })
}

function applicationOnly<const TRule extends ManagedLeafRule>(
    rule: TRule,
    fallback: InferRule<TRule>,
): TaggedRule<InferRule<TRule>, TRule> {
    return tagged(rule, {
        readLayer: "application",
        scopes: APPLICATION_SCOPES,
        fallback,
    })
}

function encodeTrimmedStringOrNull(value: string): JsonValue {
    return value.trim() || null
}

// --- Pi settings.json ---

export const PI_PACKAGE_SETTINGS_SHAPE = {
    source: required(STRING_RULE),
    autoload: optional(BOOLEAN_RULE),
    extensions: optional(STRING_ARRAY_VALUE_RULE),
    skills: optional(STRING_ARRAY_VALUE_RULE),
    prompts: optional(STRING_ARRAY_VALUE_RULE),
    themes: optional(STRING_ARRAY_VALUE_RULE),
} satisfies StrictShape

const PACKAGE_SOURCE_OBJECT_RULE = strictObjectRule(
    PI_PACKAGE_SETTINGS_SHAPE,
    "a package source object",
)

export const PACKAGE_SOURCE_RULE = unionRule(
    [STRING_RULE, PACKAGE_SOURCE_OBJECT_RULE] as const,
    "a string or package source object",
)

export const PI_RETRY_PROVIDER_RULE = objectRule({
    timeoutMs: NON_NEGATIVE_NUMBER_RULE,
    maxRetries: NON_NEGATIVE_NUMBER_RULE,
    maxRetryDelayMs: NON_NEGATIVE_NUMBER_RULE,
})

export const PI_RETRY_RULE = objectRule({
    enabled: BOOLEAN_RULE,
    maxRetries: NON_NEGATIVE_NUMBER_RULE,
    baseDelayMs: NON_NEGATIVE_NUMBER_RULE,
    provider: PI_RETRY_PROVIDER_RULE,
})

export const PI_COMPACTION_RULE = objectRule({
    enabled: BOOLEAN_RULE,
    reserveTokens: NON_NEGATIVE_NUMBER_RULE,
    keepRecentTokens: NON_NEGATIVE_NUMBER_RULE,
})

export const PI_BRANCH_SUMMARY_RULE = objectRule({
    reserveTokens: NON_NEGATIVE_NUMBER_RULE,
    skipPrompt: BOOLEAN_RULE,
})

export const PI_TERMINAL_RULE = objectRule({
    showImages: BOOLEAN_RULE,
    imageWidthCells: NON_NEGATIVE_NUMBER_RULE,
    clearOnShrink: BOOLEAN_RULE,
    showTerminalProgress: BOOLEAN_RULE,
})

export const PI_IMAGE_RULE = objectRule({
    autoResize: BOOLEAN_RULE,
    blockImages: BOOLEAN_RULE,
})

export const PI_THINKING_BUDGETS_RULE = objectRule({
    minimal: NON_NEGATIVE_NUMBER_RULE,
    low: NON_NEGATIVE_NUMBER_RULE,
    medium: NON_NEGATIVE_NUMBER_RULE,
    high: NON_NEGATIVE_NUMBER_RULE,
})

export const PI_MARKDOWN_RULE = objectRule({
    codeBlockIndent: STRING_RULE,
})

export const PI_WARNING_RULE = objectRule({
    anthropicExtraUsage: BOOLEAN_RULE,
})

// 非法 package 项过滤掉，避免一条坏配置拖垮整个列表
const PACKAGE_SOURCES_RULE = arrayRule(
    PACKAGE_SOURCE_RULE,
    "an array of package sources",
    "filter",
)
const OUTPUT_PAD_RULE = valueRule<0 | 1>(
    "0 or 1",
    (value): value is 0 | 1 => value === 0 || value === 1,
)
const THINKING_LEVEL_RULE = enumRule(
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const,
    "a supported thinking level",
)
const TRANSPORT_RULE = enumRule(
    ["auto", "sse", "websocket", "websocket-cached"] as const,
    "auto, sse, websocket, or websocket-cached",
)
const QUEUE_MODE_RULE = enumRule(
    ["all", "one-at-a-time"] as const,
    "a supported queue mode",
)
const PROJECT_TRUST_RULE = enumRule(
    ["ask", "always", "never"] as const,
    "ask, always, or never",
)
const DOUBLE_ESCAPE_ACTION_RULE = enumRule(
    ["fork", "tree", "none"] as const,
    "fork, tree, or none",
)
const TREE_FILTER_MODE_RULE = enumRule(
    ["default", "no-tools", "user-only", "labeled-only", "all"] as const,
    "a supported tree filter mode",
)

export const PI_SETTINGS_SHAPE = {
    lastChangelogVersion: STRING_RULE,
    defaultProvider: effective(STRING_RULE, "", encodeTrimmedStringOrNull),
    defaultModel: effective(STRING_RULE, "", encodeTrimmedStringOrNull),
    theme: STRING_RULE,
    externalEditor: STRING_RULE,
    shellPath: STRING_RULE,
    shellCommandPrefix: STRING_RULE,
    trackingId: STRING_RULE,
    sessionDir: STRING_RULE,
    httpProxy: STRING_RULE,
    hideThinkingBlock: BOOLEAN_RULE,
    showCacheMissNotices: BOOLEAN_RULE,
    quietStartup: BOOLEAN_RULE,
    collapseChangelog: BOOLEAN_RULE,
    enableInstallTelemetry: BOOLEAN_RULE,
    enableAnalytics: BOOLEAN_RULE,
    enableSkillCommands: BOOLEAN_RULE,
    showHardwareCursor: BOOLEAN_RULE,
    editorPaddingX: NON_NEGATIVE_NUMBER_RULE,
    autocompleteMaxVisible: NON_NEGATIVE_NUMBER_RULE,
    httpIdleTimeoutMs: NON_NEGATIVE_NUMBER_RULE,
    websocketConnectTimeoutMs: NON_NEGATIVE_NUMBER_RULE,
    extensions: STRING_ARRAY_RULE,
    skills: STRING_ARRAY_RULE,
    prompts: STRING_ARRAY_RULE,
    themes: STRING_ARRAY_RULE,
    npmCommand: STRING_ARRAY_RULE,
    enabledModels: STRING_ARRAY_RULE,
    defaultThinkingLevel: THINKING_LEVEL_RULE,
    transport: TRANSPORT_RULE,
    steeringMode: QUEUE_MODE_RULE,
    followUpMode: QUEUE_MODE_RULE,
    defaultProjectTrust: PROJECT_TRUST_RULE,
    doubleEscapeAction: DOUBLE_ESCAPE_ACTION_RULE,
    treeFilterMode: TREE_FILTER_MODE_RULE,
    packages: PACKAGE_SOURCES_RULE,
    outputPad: OUTPUT_PAD_RULE,
    compaction: PI_COMPACTION_RULE,
    branchSummary: PI_BRANCH_SUMMARY_RULE,
    retry: PI_RETRY_RULE,
    terminal: PI_TERMINAL_RULE,
    images: PI_IMAGE_RULE,
    thinkingBudgets: PI_THINKING_BUDGETS_RULE,
    markdown: PI_MARKDOWN_RULE,
    warnings: PI_WARNING_RULE,
} satisfies SchemaShape

// --- settings.vibefly.json ---

const LOCALE_MODE_RULE = enumRule(
    ["follow_ide", "en", "zh"] as const,
    "follow_ide, en, or zh",
)
type LocaleMode = InferRule<typeof LOCALE_MODE_RULE>
const DEFAULT_LOCALE: LocaleMode = "follow_ide"

export const VIBEFLY_COMMIT_RULE = objectRule({
    languageMode: effective(LOCALE_MODE_RULE, DEFAULT_LOCALE),
    commitModelSpec: effective(STRING_RULE, ""),
    useCustomPrompt: effective(BOOLEAN_RULE, false),
    customPrompt: effective(STRING_RULE, ""),
})

export const VIBEFLY_MODEL_PREFERENCES_RULE = objectRule({
    recentModelSpecs: applicationOnly(STRING_ARRAY_RULE, EMPTY_STRING_ARRAY),
    pinnedModelSpecs: applicationOnly(STRING_ARRAY_RULE, EMPTY_STRING_ARRAY),
})

export const VIBEFLY_UI_RULE = objectRule({
    locale: effective(LOCALE_MODE_RULE, DEFAULT_LOCALE),
})

export const VIBEFLY_SETTINGS_SHAPE = {
    commit: VIBEFLY_COMMIT_RULE,
    modelPreferences: VIBEFLY_MODEL_PREFERENCES_RULE,
    ui: VIBEFLY_UI_RULE,
} satisfies SchemaShape
