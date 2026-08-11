import {
    cloneJsonValue,
    type JsonValue,
    parseJsonObjectDocument,
    type SafeSettingsSnapshot,
    type SettingsScope,
} from "./schema.js"

export type SettingsDocument = "settings" | "vibefly"
export type SettingReadLayer = "effective" | "application"

export type SettingKey<T> = {
    readonly id: string
    readonly document: SettingsDocument
    readonly path: readonly string[]
    readonly scopes: readonly SettingsScope[]
    readonly readLayer: SettingReadLayer
    readonly defaultValue: T
    readonly decode: (value: JsonValue | undefined) => T
    readonly encode: (value: T) => JsonValue
}

export type AnySettingKey = SettingKey<any>

type SettingKeyOptions<T> = Omit<SettingKey<T>, "id"> & {id?: string}

export function defineSetting<T>(options: SettingKeyOptions<T>): SettingKey<T> {
    return Object.freeze({
        ...options,
        id: options.id ?? `${options.document}:${options.path.join(".")}`,
        path: Object.freeze([...options.path]),
        scopes: Object.freeze([...options.scopes]),
    })
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

const stringValue = (fallback = "") => (value: JsonValue | undefined): string =>
    typeof value === "string" ? value : fallback
const nullableTrimmedString = (value: string): JsonValue => value.trim() || null
const booleanValue = (fallback: boolean) => (value: JsonValue | undefined): boolean =>
    typeof value === "boolean" ? value : fallback
const stringArrayValue = (value: JsonValue | undefined): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
const cloneStrings = (value: string[]): JsonValue => [...value]

const localeValue = (value: JsonValue | undefined): "follow_ide" | "en" | "zh" =>
    value === "en" || value === "zh" ? value : "follow_ide"

export const settingKeys = {
    defaultProvider: defineSetting({
        document: "settings", path: ["defaultProvider"], scopes: ["application", "project"],
        readLayer: "effective", defaultValue: "", decode: stringValue(), encode: nullableTrimmedString,
    }),
    defaultModel: defineSetting({
        document: "settings", path: ["defaultModel"], scopes: ["application", "project"],
        readLayer: "effective", defaultValue: "", decode: stringValue(), encode: nullableTrimmedString,
    }),
    commitLanguageMode: defineSetting({
        document: "vibefly", path: ["commit", "languageMode"], scopes: ["application", "project"],
        readLayer: "effective", defaultValue: "follow_ide" as const, decode: localeValue, encode: (value) => value,
    }),
    commitModelSpec: defineSetting({
        document: "vibefly", path: ["commit", "commitModelSpec"], scopes: ["application", "project"],
        readLayer: "effective", defaultValue: "", decode: stringValue(), encode: (value) => value,
    }),
    commitUseCustomPrompt: defineSetting({
        document: "vibefly", path: ["commit", "useCustomPrompt"], scopes: ["application", "project"],
        readLayer: "effective", defaultValue: false, decode: booleanValue(false), encode: (value) => value,
    }),
    commitCustomPrompt: defineSetting({
        document: "vibefly", path: ["commit", "customPrompt"], scopes: ["application", "project"],
        readLayer: "effective", defaultValue: "", decode: stringValue(), encode: (value) => value,
    }),
    recentModelSpecs: defineSetting({
        document: "vibefly", path: ["modelPreferences", "recentModelSpecs"], scopes: ["application"],
        readLayer: "application", defaultValue: [] as string[], decode: stringArrayValue, encode: cloneStrings,
    }),
    pinnedModelSpecs: defineSetting({
        document: "vibefly", path: ["modelPreferences", "pinnedModelSpecs"], scopes: ["application"],
        readLayer: "application", defaultValue: [] as string[], decode: stringArrayValue, encode: cloneStrings,
    }),
    uiLocale: defineSetting({
        document: "vibefly", path: ["ui", "locale"], scopes: ["application", "project"],
        readLayer: "effective", defaultValue: "follow_ide" as const, decode: localeValue, encode: (value) => value,
    }),
} as const

export function cloneSettingValue<T>(value: T): T {
    if (value === undefined) return value
    return cloneJsonValue(value as JsonValue) as T
}
