import {
    cloneJsonValue,
    type JsonValue,
    parseJsonObjectDocument,
    type SafeSettingsSnapshot,
    type SettingsScope,
} from "./schema.js"

export type SettingsDocument = "settings" | "vibefly"
export type SettingReadLayer = "effective" | "application"

export type SettingCodec<T> = {
    readonly decode: (value: JsonValue | undefined) => T
    readonly encode: (value: T) => JsonValue
}

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

type SettingLeafDef<T = any> = {
    readonly __leaf: true
    readonly readLayer: SettingReadLayer
    readonly scopes: readonly SettingsScope[]
    readonly codec: SettingCodec<T>
}

type SettingDefNode = SettingLeafDef | {readonly [key: string]: SettingDefNode}

type InferSettingKeys<D> = D extends SettingLeafDef<infer T>
    ? SettingKey<T>
    : D extends Record<string, any>
        ? {readonly [K in keyof D]: InferSettingKeys<D[K]>}
        : never

const EMPTY_STRING_ARRAY: readonly string[] = Object.freeze([])

export function stringCodec(fallback = ""): SettingCodec<string> {
    return {
        decode: (value) => (typeof value === "string" ? value : fallback),
        encode: (value) => value,
    }
}

export function nullableTrimmedStringCodec(fallback = ""): SettingCodec<string> {
    return {
        decode: (value) => (typeof value === "string" ? value : fallback),
        encode: (value) => value.trim() || null,
    }
}

export function booleanCodec(fallback: boolean): SettingCodec<boolean> {
    return {
        decode: (value) => (typeof value === "boolean" ? value : fallback),
        encode: (value) => value,
    }
}

export function stringArrayCodec(): SettingCodec<string[]> {
    return {
        decode: (value) => {
            if (!Array.isArray(value)) return EMPTY_STRING_ARRAY as string[]
            return value.filter((item): item is string => typeof item === "string")
        },
        encode: (value) => [...value],
    }
}

export function localeCodec(): SettingCodec<"follow_ide" | "en" | "zh"> {
    return {
        decode: (value) => (value === "en" || value === "zh" ? value : "follow_ide"),
        encode: (value) => value,
    }
}

export function effective<T>(codec: SettingCodec<T>): SettingLeafDef<T> {
    return Object.freeze({
        __leaf: true,
        readLayer: "effective",
        scopes: Object.freeze(["application", "project"] as const),
        codec,
    })
}

export function application<T>(codec: SettingCodec<T>): SettingLeafDef<T> {
    return Object.freeze({
        __leaf: true,
        readLayer: "application",
        scopes: Object.freeze(["application"] as const),
        codec,
    })
}

function isLeaf(node: SettingDefNode): node is SettingLeafDef {
    return (node as SettingLeafDef).__leaf === true
}

function buildSettingKey<T>(
    document: SettingsDocument,
    path: readonly string[],
    leaf: SettingLeafDef<T>,
): SettingKey<T> {
    return Object.freeze({
        id: `${document}:${path.join(".")}`,
        document,
        path: Object.freeze([...path]),
        scopes: leaf.scopes,
        readLayer: leaf.readLayer,
        decode: leaf.codec.decode,
        encode: leaf.codec.encode,
    })
}

function buildTree(
    document: SettingsDocument,
    definition: SettingDefNode,
    path: readonly string[],
): unknown {
    if (isLeaf(definition)) {
        return buildSettingKey(document, path, definition)
    }
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(definition)) {
        result[key] = buildTree(document, child, [...path, key])
    }
    return Object.freeze(result)
}

export function defineSettings<const D extends SettingDefNode>(
    document: SettingsDocument,
    definition: D,
): InferSettingKeys<D> {
    return buildTree(document, definition, []) as InferSettingKeys<D>
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
    ...defineSettings("settings", {
        defaultProvider: effective(nullableTrimmedStringCodec()),
        defaultModel: effective(nullableTrimmedStringCodec()),
    }),
    ...defineSettings("vibefly", {
        commit: {
            languageMode: effective(localeCodec()),
            commitModelSpec: effective(stringCodec()),
            useCustomPrompt: effective(booleanCodec(false)),
            customPrompt: effective(stringCodec()),
        },
        modelPreferences: {
            recentModelSpecs: application(stringArrayCodec()),
            pinnedModelSpecs: application(stringArrayCodec()),
        },
        ui: {
            locale: effective(localeCodec()),
        },
    }),
})

export function cloneSettingValue<T>(value: T): T {
    if (value === undefined) return value
    return cloneJsonValue(value as JsonValue) as T
}
