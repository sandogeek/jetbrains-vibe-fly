import {useCallback, useMemo, useSyncExternalStore} from "react"
import type {SettingKey} from "@vibefly/uiagent-shared"
import {SettingKeyStore} from "./settingKeyStore"

/**
 * Subscribe to a single SettingKey leaf. Snapshot identity is stable until the
 * store replaces that key's value.
 * 订阅单个 SettingKey 叶子。快照引用在 Store 替换该 key 的值之前保持稳定。
 */
export function useSettingKey<T>(
    store: SettingKeyStore | null | undefined,
    key: SettingKey<T>,
): T {
    const defaultValue = useMemo(() => key.decode(undefined), [key])
    const subscribe = useCallback(
        (listener: () => void) => store?.subscribeKey(key, listener) ?? (() => undefined),
        [store, key],
    )
    const getSnapshot = useCallback(
        () => store ? store.getKey(key) : defaultValue,
        [store, key, defaultValue],
    )
    const getServerSnapshot = useCallback(() => defaultValue, [defaultValue])

    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
