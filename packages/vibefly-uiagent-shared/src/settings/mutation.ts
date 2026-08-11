import {
    parseJsonObjectDocument,
    type SafeSettingsSnapshot,
    setJsonAtPath,
} from "./schema.js"
import type {SettingKey} from "./keys.js"

export type SetSettingMutation<T = unknown> = {
    readonly kind: "set"
    readonly key: SettingKey<T>
    readonly value: T
}

export type UnsetSettingMutation<T = unknown> = {
    readonly kind: "unset"
    readonly key: SettingKey<T>
}

export type SettingMutation<T = any> = SetSettingMutation<T> | UnsetSettingMutation<T>

export type MutatedSettingDocuments = {
    settingsJson: string
    vibeflyJson: string
    settingsChanged: boolean
    vibeflyChanged: boolean
}

export function setSetting<T>(key: SettingKey<T>, value: T): SettingMutation<T> {
    return {kind: "set", key, value}
}

export function unsetSetting<T>(key: SettingKey<T>): SettingMutation<T> {
    return {kind: "unset", key}
}

export function settingMutationId(mutation: SettingMutation): string {
    return mutation.key.id
}

/** Last semantic write for one typed key wins while preserving key insertion order. */
export function mergeSettingMutations(
    base: readonly SettingMutation[],
    update: readonly SettingMutation[],
): SettingMutation[] {
    const merged = new Map(base.map((mutation) => [settingMutationId(mutation), mutation]))
    for (const mutation of update) merged.set(settingMutationId(mutation), mutation)
    return [...merged.values()]
}

function encode(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`
}

/** Apply semantic writes to one raw scope while retaining all unrelated JSON keys. */
export function applySettingMutations(
    snapshot: SafeSettingsSnapshot,
    operations: readonly SettingMutation[],
): MutatedSettingDocuments {
    let settings = parseJsonObjectDocument(snapshot.settingsJson, "settings.json").value
    let vibefly = parseJsonObjectDocument(snapshot.vibeflyJson, "settings.vibefly.json").value
    let settingsChanged = false
    let vibeflyChanged = false
    for (const operation of operations) {
        if (!operation.key.scopes.includes(snapshot.scope)) {
            throw new Error(`${operation.key.id} cannot be written at ${snapshot.scope} scope`)
        }
        const value = operation.kind === "set" ? operation.key.encode(operation.value) : undefined
        if (operation.key.document === "settings") {
            settings = setJsonAtPath(settings, operation.key.path, value)
            settingsChanged = true
        } else {
            vibefly = setJsonAtPath(vibefly, operation.key.path, value)
            vibeflyChanged = true
        }
    }
    return {
        settingsJson: settingsChanged ? encode(settings) : snapshot.settingsJson,
        vibeflyJson: vibeflyChanged ? encode(vibefly) : snapshot.vibeflyJson,
        settingsChanged,
        vibeflyChanged,
    }
}
