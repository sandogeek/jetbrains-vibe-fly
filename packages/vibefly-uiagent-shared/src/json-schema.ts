/**
 * 轻量 JSON 对象 schema：用规则描述形状，做软校验（修数据 + 记诊断），并推断 TS 类型。
 *
 * 规则种类：
 * - value：标量 / 自定义谓词
 * - object：宽松对象（未知字段保留；null 视为显式值）
 * - strict-object：仅用于 union 分支匹配，字段可标 required/optional
 * - array：整表 reject，或 filter 掉非法元素
 * - union：任一分支匹配即可
 */

import {cloneJsonValue, hasOwn, isJsonObject, type JsonObject, type JsonValue,} from "./json.js"

export type SchemaDiagnostic = {
    severity: "error" | "warning"
    message: string
}

export type SchemaValidationResult<T extends JsonObject> = {
    value: T
    diagnostics: SchemaDiagnostic[]
}

export type ValueRule<TValue extends JsonValue = JsonValue> = {
    kind: "value"
    expected: string
    test: (value: JsonValue) => value is TValue
}

export interface ArrayRule<TItemRule extends SchemaRule = SchemaRule> {
    kind: "array"
    expected: string
    item: TItemRule
    /** reject：任一非法则整数组失败；filter：去掉非法项并写诊断 */
    invalidItems: "reject" | "filter"
}

export interface ObjectRule<TShape extends SchemaShape = SchemaShape> {
    kind: "object"
    expected: "an object"
    shape: TShape
}

export interface StrictObjectRule<TShape extends StrictShape = StrictShape> {
    kind: "strict-object"
    expected: string
    shape: TShape
}

export interface UnionRule<TRules extends readonly SchemaRule[] = readonly SchemaRule[]> {
    kind: "union"
    expected: string
    rules: TRules
}

export interface SchemaShape {
    [key: string]: SchemaRule
}

export type SchemaRule = ValueRule | ArrayRule | ObjectRule | StrictObjectRule | UnionRule

/** 由规则推断 TS 值类型 */
export type InferRule<TRule extends SchemaRule> =
    TRule extends ValueRule<infer TValue>
        ? TValue
        : TRule extends ObjectRule<infer TShape>
            ? SchemaObject<TShape>
            : TRule extends StrictObjectRule<infer TShape>
                ? StrictObject<TShape>
                : TRule extends ArrayRule<infer TItemRule>
                    ? InferRule<TItemRule>[]
                    : TRule extends UnionRule<infer TRules>
                        ? InferRule<TRules[number]>
                        : never

/**
 * 宽松对象：已知键可选，且允许显式 null（配置覆盖语义）。
 * 对开放 SchemaShape（索引签名）退化为 JsonObject，避免 InferRule 无限展开。
 */
export type SchemaObject<TShape extends SchemaShape> = string extends keyof TShape
    ? JsonObject
    : JsonObject & {
        [TKey in keyof TShape]?: InferRule<TShape[TKey]> | null
    }

export type StrictField<TRule extends ValueRule = ValueRule> = {
    required: boolean
    rule: TRule
}

export type StrictShape = Record<string, StrictField>

type RequiredStrictKey<TShape extends StrictShape> = {
    [TKey in keyof TShape]-?: TShape[TKey]["required"] extends true
        ? TKey
        : never
}[keyof TShape]

export type StrictObject<TShape extends StrictShape> = JsonObject & {
    [TKey in RequiredStrictKey<TShape>]: InferRule<TShape[TKey]["rule"]>
} & {
    [TKey in Exclude<keyof TShape, RequiredStrictKey<TShape>>]?: InferRule<TShape[TKey]["rule"]>
}

export function valueRule<TValue extends JsonValue>(
    expected: string,
    test: (value: JsonValue) => value is TValue,
): ValueRule<TValue> {
    return {kind: "value", expected, test}
}

export function objectRule<const TShape extends SchemaShape>(
    shape: TShape,
): ObjectRule<TShape> {
    return {kind: "object", expected: "an object", shape}
}

export function strictObjectRule<const TShape extends StrictShape>(
    shape: TShape,
    expected: string,
): StrictObjectRule<TShape> {
    return {kind: "strict-object", expected, shape}
}

export function arrayRule<const TItemRule extends SchemaRule>(
    item: TItemRule,
    expected: string,
    invalidItems: "reject" | "filter" = "reject",
): ArrayRule<TItemRule> {
    return {kind: "array", expected, item, invalidItems}
}

export function unionRule<const TRules extends readonly SchemaRule[]>(
    rules: TRules,
    expected: string,
): UnionRule<TRules> {
    return {kind: "union", expected, rules}
}

export function required<const TRule extends ValueRule>(rule: TRule): {
    required: true
    rule: TRule
} {
    return {required: true, rule}
}

export function optional<const TRule extends ValueRule>(rule: TRule): {
    required: false
    rule: TRule
} {
    return {required: false, rule}
}

export function stringValue(value: JsonValue): value is string {
    return typeof value === "string"
}

export function booleanValue(value: JsonValue): value is boolean {
    return typeof value === "boolean"
}

export function numberValue(value: JsonValue): value is number {
    return typeof value === "number" && Number.isFinite(value)
}

export function nonNegativeNumber(value: JsonValue): value is number {
    return numberValue(value) && value >= 0
}

export function stringArray(value: JsonValue): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string")
}

export function enumRule<const TValues extends readonly string[]>(
    values: TValues,
    expected: string,
): ValueRule<TValues[number]> {
    const supported = new Set<string>(values)
    return valueRule(
        expected,
        (value): value is TValues[number] => typeof value === "string" && supported.has(value),
    )
}

export const STRING_RULE = valueRule("a string", stringValue)
export const BOOLEAN_RULE = valueRule("a boolean", booleanValue)
export const NON_NEGATIVE_NUMBER_RULE = valueRule("a non-negative number", nonNegativeNumber)
/** 整段数组作 value 校验（reject 语义），用于 strict 字段等 */
export const STRING_ARRAY_VALUE_RULE = valueRule("an array of strings", stringArray)
/** 数组规则 + 元素校验，默认整表 reject */
export const STRING_ARRAY_RULE = arrayRule(STRING_RULE, "an array of strings")

/** 仅做匹配、不改写；用于 union / filter 前判断 */
export function matchesStrictObject<TShape extends StrictShape>(
    value: JsonValue,
    shape: TShape,
): value is StrictObject<TShape> {
    if (!isJsonObject(value)) return false
    for (const [key, field] of Object.entries(shape)) {
        if (!hasOwn(value, key)) {
            if (field.required) return false
            continue
        }
        if (!field.rule.test(value[key]!)) return false
    }
    return true
}

export function matchesRule(value: JsonValue, rule: SchemaRule): boolean {
    switch (rule.kind) {
        case "value":
            return rule.test(value)
        case "object":
            if (!isJsonObject(value)) return false
            return Object.entries(rule.shape).every(([key, childRule]) => {
                return !hasOwn(value, key) || value[key] === null || matchesRule(value[key]!, childRule)
            })
        case "strict-object":
            return matchesStrictObject(value, rule.shape)
        case "array":
            return Array.isArray(value) && value.every((item) => matchesRule(item, rule.item))
        case "union":
            return rule.rules.some((candidate) => matchesRule(value, candidate))
    }
}

/**
 * 校验单值。
 * object：进入子字段软校验并返回 true（类型层面已是对象）。
 * array+filter：原地 splice 保留合法项。
 * 失败时返回 false，由调用方决定是否删除字段。
 */
export function validateRule(
    value: JsonValue,
    rule: SchemaRule,
    path: string,
    diagnostics: SchemaDiagnostic[],
): boolean {
    switch (rule.kind) {
        case "value":
            return rule.test(value)
        case "object":
            if (!isJsonObject(value)) return false
            validateObject(value, rule.shape, path, diagnostics)
            return true
        case "strict-object":
            return matchesStrictObject(value, rule.shape)
        case "union":
            return matchesRule(value, rule)
        case "array":
            if (!Array.isArray(value)) return false
            if (rule.invalidItems === "reject") {
                return value.every((item) => matchesRule(item, rule.item))
            }

            const validItems: JsonValue[] = []
            for (const [index, item] of value.entries()) {
                if (matchesRule(item, rule.item)) {
                    validItems.push(item)
                    continue
                }
                diagnostics.push({
                    severity: "error",
                    message: `${path}[${index}] must be ${rule.item.expected}`,
                })
            }
            value.splice(0, value.length, ...validItems)
            return true
    }
}

/**
 * 软校验对象：
 * - 未知字段保留（向前兼容）
 * - 已知字段为 null 保留（显式清空 / 覆盖）
 * - 已知字段类型不合法则删除并记 error
 * - 就地修改 value
 */
export function validateObject<TShape extends SchemaShape>(
    value: JsonObject,
    shape: TShape,
    path: string,
    diagnostics: SchemaDiagnostic[],
): SchemaObject<TShape> {
    for (const [key, rule] of Object.entries(shape)) {
        if (!hasOwn(value, key) || value[key] === null) continue
        const child = value[key]!
        if (validateRule(child, rule, `${path}.${key}`, diagnostics)) continue

        delete value[key]
        diagnostics.push({
            severity: "error",
            message: `${path}.${key} must be ${rule.expected}`,
        })
    }
    return value as SchemaObject<TShape>
}

/** 解析 JSON 文本为对象；非法 JSON 或非对象根返回 {} + 诊断 */
export function parseJsonObject(source: string): SchemaValidationResult<JsonObject> {
    let parsed: unknown
    try {
        parsed = JSON.parse(source)
    } catch (error) {
        const detail = error instanceof Error ? error.message : "invalid JSON"
        return {
            value: {},
            diagnostics: [{severity: "error", message: `Invalid JSON: ${detail}`}],
        }
    }
    if (!isJsonObject(parsed)) {
        return {
            value: {},
            diagnostics: [{severity: "error", message: "Document root must be an object"}],
        }
    }
    return {value: cloneJsonValue(parsed), diagnostics: []}
}

/** 解析文档后按 shape 软校验 */
export function parseAndValidateObject<TShape extends SchemaShape>(
    source: string,
    shape: TShape,
    rootPath = "$",
): SchemaValidationResult<SchemaObject<TShape>> {
    const parsed = parseJsonObject(source)
    const diagnostics = parsed.diagnostics
    const value = validateObject(parsed.value, shape, rootPath, diagnostics)
    return {value, diagnostics}
}
