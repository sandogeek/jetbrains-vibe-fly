/** 与 JSON 兼容的值类型与不可变更新工具（无原型污染）。 */

export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export type JsonObject = {
    [key: string]: JsonValue
}

export function hasOwn(object: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(object, key)
}

/** 用 defineProperty 写入，避免 `__proto__` 等键污染原型链。 */
export function defineValue(object: JsonObject, key: string, value: JsonValue): void {
    Object.defineProperty(object, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
    })
}

export function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 深拷贝；对象键一律经 defineValue 写入。 */
export function cloneJsonValue<T extends JsonValue>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => cloneJsonValue(item)) as T
    }
    if (!isJsonObject(value)) return value
    const clone: JsonObject = {}
    for (const [key, child] of Object.entries(value)) {
        defineValue(clone, key, cloneJsonValue(child))
    }
    return clone as T
}

/**
 * 递归合并 JSON 对象。
 * 仅对象与对象深层合并；数组、标量、null 整段被 override 替换。
 */
export function deepMergeJsonObjects(base: JsonObject, override: JsonObject): JsonObject {
    const merged = cloneJsonValue(base)
    for (const [key, overrideValue] of Object.entries(override)) {
        const baseValue = hasOwn(base, key) ? base[key] : undefined
        const next = isJsonObject(baseValue) && isJsonObject(overrideValue)
            ? deepMergeJsonObjects(baseValue, overrideValue)
            : cloneJsonValue(overrideValue)
        defineValue(merged, key, next)
    }
    return merged
}

/**
 * 按路径不可变更新：返回新对象树，不修改 source。
 * updater 返回 undefined 时删除该键。
 */
export function updateJsonAtPath(
    source: JsonObject,
    path: readonly string[],
    updater: (current: JsonValue | undefined) => JsonValue | undefined,
): JsonObject {
    if (path.length === 0) throw new Error("JSON update path must not be empty")

    const updateObject = (current: JsonObject, index: number): JsonObject => {
        const output = cloneJsonValue(current)
        const key = path[index]!
        if (index === path.length - 1) {
            const next = updater(hasOwn(current, key) ? cloneJsonValue(current[key]!) : undefined)
            if (next === undefined) delete output[key]
            else defineValue(output, key, cloneJsonValue(next))
            return output
        }

        const child = hasOwn(current, key) && isJsonObject(current[key])
            ? current[key] as JsonObject
            : {}
        defineValue(output, key, updateObject(child, index + 1))
        return output
    }

    return updateObject(source, 0)
}

/** 按路径设置值；value 为 undefined 时删除该键。 */
export function setJsonAtPath(
    source: JsonObject,
    path: readonly string[],
    value: JsonValue | undefined,
): JsonObject {
    return updateJsonAtPath(source, path, () => value)
}
