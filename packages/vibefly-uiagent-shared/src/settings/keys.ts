import {
    type ObjectRule,
    type SchemaRule,
    type SchemaShape,
    validateRule,
} from "../json-schema.js"
import {
    isTaggedRule,
    PI_SETTINGS_SHAPE,
    type SettingReadLayer,
    type TaggedRule,
    VIBEFLY_SETTINGS_SHAPE,
} from "./definition.js"
import {
    cloneJsonValue,
    type JsonValue,
    parseJsonObjectDocument,
    type SafeSettingsSnapshot,
    type SettingsScope,
} from "./schema.js"

export type {SettingReadLayer} from "./definition.js"

export type SettingsDocument = "settings" | "vibefly"

export type SettingKey<T> = {
    readonly id: string
    readonly document: SettingsDocument
    readonly path: readonly string[]
    readonly scopes: readonly SettingsScope[]
    readonly readLayer: SettingReadLayer
    readonly decode: (value: JsonValue | undefined) => T
    readonly encode: (value: T) => JsonValue
}

export type AnySettingKey = SettingKey<any>

type ManagedValue<TRule> = TRule extends {readonly __managed: {readonly fallback: infer TValue}}
    ? TValue
    : never

type IsManaged<TRule> = TRule extends {readonly __managed: unknown} ? true : false

type HasManagedDescendant<TRule> =
    IsManaged<TRule> extends true
        ? true
        : TRule extends ObjectRule<infer TShape>
            ? true extends {
                [TKey in keyof TShape]: HasManagedDescendant<TShape[TKey]>
            }[keyof TShape]
                ? true
                : false
            : false

type InferSettingKeys<TShape> = {
    readonly [TKey in keyof TShape as HasManagedDescendant<TShape[TKey]> extends true
        ? TKey
        : never]: InferSettingNode<TShape[TKey]>
}

type InferSettingNode<TRule> =
    IsManaged<TRule> extends true
        ? SettingKey<ManagedValue<TRule>>
        : TRule extends ObjectRule<infer TShape>
            ? InferSettingKeys<TShape>
            : never

function decodeWithRule<T>(rule: SchemaRule, fallback: T, value: JsonValue | undefined): T {
    if (value === undefined || value === null) return fallback
    const candidate = cloneJsonValue(value)
    if (!validateRule(candidate, rule, "$", [])) return fallback
    return candidate as T
}

function identityEncode<T>(value: T): JsonValue {
    return value as JsonValue
}

function buildSettingKey<T>(
    document: SettingsDocument,
    path: readonly string[],
    rule: TaggedRule,
): SettingKey<T> {
    const meta = rule.__managed
    return Object.freeze({
        id: `${document}:${path.join(".")}`,
        document,
        path: Object.freeze([...path]),
        scopes: meta.scopes,
        readLayer: meta.readLayer,
        decode: (value: JsonValue | undefined) => decodeWithRule(rule, meta.fallback, value) as T,
        encode: (meta.encode as ((value: T) => JsonValue) | undefined) ?? identityEncode,
    })
}

function collectSettingKeys(
    document: SettingsDocument,
    shape: SchemaShape,
    path: readonly string[] = [],
): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, rule] of Object.entries(shape)) {
        const childPath = [...path, key]
        if (isTaggedRule(rule)) {
            result[key] = buildSettingKey(document, childPath, rule)
            continue
        }
        if (rule.kind === "object") {
            const nested = collectSettingKeys(document, rule.shape, childPath)
            if (Object.keys(nested).length > 0) result[key] = nested
        }
    }
    return Object.freeze(result)
}

function atPath(value: JsonValue | undefined, path: readonly string[]): JsonValue | undefined {
    let current = value
    for (const key of path) {
        if (!current || typeof current !== "object" || Array.isArray(current)) return undefined
        current = current[key]
    }
    return current
}

export function readSettingFromSnapshot<T>(
    snapshot: SafeSettingsSnapshot,
    key: SettingKey<T>,
): T {
    const source = key.document === "settings" ? snapshot.settingsJson : snapshot.vibeflyJson
    const file = key.document === "settings" ? "settings.json" : "settings.vibefly.json"
    return key.decode(atPath(parseJsonObjectDocument(source, file).value, key.path))
}

export const settingKeys = Object.freeze({
    ...collectSettingKeys("settings", PI_SETTINGS_SHAPE),
    ...collectSettingKeys("vibefly", VIBEFLY_SETTINGS_SHAPE),
}) as InferSettingKeys<typeof PI_SETTINGS_SHAPE> & InferSettingKeys<typeof VIBEFLY_SETTINGS_SHAPE>

export function cloneSettingValue<T>(value: T): T {
    if (value === undefined) return value
    return cloneJsonValue(value as JsonValue) as T
}
