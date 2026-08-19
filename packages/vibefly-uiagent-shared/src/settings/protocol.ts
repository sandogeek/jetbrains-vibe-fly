/**
 * File-level settings protocol: revisions, source tracking, and UI/Agent DTOs.
 * 文件级设置协议：revision、来源追踪，以及 UI/Agent DTO。
 */
import {hasOwn, isJsonObject, type JsonObject, type JsonValue} from "../json.js"
import {type AnySettingKey, type SettingsDocument} from "./keys.js"
import {
    parseJsonObjectDocument,
    type SafeSettingsSnapshot,
    type SettingsFileName,
    type SettingsFileRevisions,
    type SettingsScope,
} from "./schema.js"

export type SettingsFile = SettingsFileName

export type SettingSource = "application" | "project" | "default"

export type SettingsFileChange = {
    scope: SettingsScope
    projectRoot: string | null
    document: SettingsFileName
    revision: string
}

export type SettingsChangedNotification = {
    changes: SettingsFileChange[]
}

/** @deprecated Use SettingsChangedNotification. Kept as an alias for call-site updates. */
export type SettingsChanged = SettingsChangedNotification

export type SettingDocumentFile = "settings.json" | "settings.vibefly.json"

export type SettingValueResult<T = unknown> = {
    keyId: string
    value: T
    source: SettingSource
    document: SettingDocumentFile
    revisions: {
        application: string
        project: string | null
    }
    sequence: number
}

export type SettingMutationOperation =
    | {kind: "set"; keyId: string; value: unknown; targetScope?: SettingsScope}
    | {kind: "unset"; keyId: string; targetScope?: SettingsScope}

export type SettingMutationRequest = {
    clientMutationId: string
    operations: SettingMutationOperation[]
}

export type SettingMutationResult = {
    ok: boolean
    clientMutationId: string
    conflict?: boolean
    error?: string
}

export type AgentSettingsInvalidation = {
    changes: Array<{
        scope: SettingsScope
        document: SettingsFileName
        revision: string
    }>
    sequence: number
}

export const SETTINGS_DOCUMENT_FILES = [
    "settings.json",
    "settings.vibefly.json",
    "models.json",
    "auth.json",
] as const satisfies readonly SettingsFileName[]

export function isSettingsFileName(value: string): value is SettingsFileName {
    return (SETTINGS_DOCUMENT_FILES as readonly string[]).includes(value)
}

export function settingDocumentFile(document: SettingsDocument): SettingDocumentFile {
    return document === "settings" ? "settings.json" : "settings.vibefly.json"
}

export function fileRevision(
    revisions: SettingsFileRevisions | undefined,
    file: SettingsFileName,
): string {
    return revisions?.[file] ?? ""
}

export function sameFileRevisions(
    left: SettingsFileRevisions,
    right: SettingsFileRevisions,
): boolean {
    const keys = new Set([
        ...Object.keys(left),
        ...Object.keys(right),
    ] as SettingsFileName[])
    for (const key of keys) {
        if (left[key] !== right[key]) return false
    }
    return true
}

/**
 * Whether a raw JSON layer covers `path` under the same deep-merge rules as
 * application/project override: objects recurse, while a scalar, array, or null
 * parent replaces the rest of the path.
 */
export function layerCoversPath(root: JsonValue | undefined, path: readonly string[]): boolean {
    if (root === undefined) return false
    let current: JsonValue | undefined = root
    for (const key of path) {
        if (current === undefined) return false
        if (!isJsonObject(current)) return true
        if (!hasOwn(current, key)) return false
        current = current[key]
    }
    return true
}

export function resolveSettingSourceFromLayers(
    application: JsonObject,
    project: JsonObject | undefined,
    path: readonly string[],
): SettingSource {
    if (project && layerCoversPath(project, path)) return "project"
    if (layerCoversPath(application, path)) return "application"
    return "default"
}

export function rawDocumentObject(
    snapshot: SafeSettingsSnapshot,
    document: SettingsDocument,
): JsonObject {
    const file = settingDocumentFile(document)
    const source = document === "settings" ? snapshot.settingsJson : snapshot.vibeflyJson
    return parseJsonObjectDocument(source, file).value
}

export function resolveSettingSource(
    application: SafeSettingsSnapshot,
    project: SafeSettingsSnapshot | undefined,
    key: AnySettingKey,
): SettingSource {
    return resolveSettingSourceFromLayers(
        rawDocumentObject(application, key.document),
        project ? rawDocumentObject(project, key.document) : undefined,
        key.path,
    )
}

export function defaultWriteScope(source: SettingSource): SettingsScope {
    return source === "project" ? "project" : "application"
}

export function normalizeSettingsFileChange(raw: {
    scope?: string
    projectRoot?: string | null
    document?: string
    revision?: string
}): SettingsFileChange | null {
    if (raw.scope !== "application" && raw.scope !== "project") return null
    if (!raw.document || !isSettingsFileName(raw.document)) return null
    return {
        scope: raw.scope,
        projectRoot: raw.scope === "application" ? null : (raw.projectRoot ?? null),
        document: raw.document,
        revision: String(raw.revision ?? ""),
    }
}

export function normalizeSettingsChangedNotification(raw: {
    changes?: Array<{
        scope?: string
        projectRoot?: string | null
        document?: string
        revision?: string
    }> | null
}): SettingsChangedNotification {
    const changes: SettingsFileChange[] = []
    for (const item of raw.changes ?? []) {
        const change = normalizeSettingsFileChange(item)
        if (change) changes.push(change)
    }
    return {changes}
}
