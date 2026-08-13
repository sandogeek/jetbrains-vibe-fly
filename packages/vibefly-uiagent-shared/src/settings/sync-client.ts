import {
    computeEffectiveSettings,
    type EffectiveSettings,
    parseJsonObjectDocument,
    type SafeSettingsSnapshot,
    type SettingsChanged,
    type SettingsScope,
} from "./schema.js"
import {projectSettingValues, type SettingKey, type SettingValuesOf} from "./keys.js"
import {applySettingMutations, type SettingMutation} from "./mutation.js"

export type SettingsDocumentSaveRequest = {
    scope: SettingsScope
    settingsJson?: string
    vibeflyJson?: string
    expectedRevision: string
}

export type SettingsSaveOutcome = {
    ok: boolean
    revision: string
    conflict?: boolean
    error?: string | null
}

export interface SettingsSyncAdapter<TSnapshot extends SafeSettingsSnapshot = SafeSettingsSnapshot> {
    fetch(scope: SettingsScope): Promise<TSnapshot>
    save?(request: SettingsDocumentSaveRequest): Promise<SettingsSaveOutcome>
}

export type SettingsSyncState<TSnapshot extends SafeSettingsSnapshot = SafeSettingsSnapshot> = {
    application: Extract<TSnapshot, {scope: "application"}>
    project?: Extract<TSnapshot, {scope: "project"}>
    effective: EffectiveSettings
    hasProject: boolean
}

export type MutationResult = {
    ok: boolean
    revision: string
    attempts: number
    conflict: boolean
    error?: string
}

type Subscription<TSnapshot extends SafeSettingsSnapshot, TValue> = {
    selector: (state: SettingsSyncState<TSnapshot>) => TValue
    listener: (value: TValue, previous: TValue | undefined) => void
    equality: (left: TValue, right: TValue) => boolean
    selected?: TValue
    initialized: boolean
}

const MAX_REFRESH_FETCHES = 16
const STABLE_BASELINE_FETCHES = 3
const STABLE_CHANGED_FETCHES = 2

function assertScope(snapshot: SafeSettingsSnapshot, expected: SettingsScope): void {
    if (snapshot.scope !== expected) throw new Error(`Expected ${expected} settings snapshot`)
    if (snapshot.scope === "application" && snapshot.projectRoot !== null) {
        throw new Error("Application settings snapshot must have a null projectRoot")
    }
    if (snapshot.scope === "project" && !snapshot.projectRoot.trim()) {
        throw new Error("Project settings snapshot must have a projectRoot")
    }
}

export class SettingsSyncClient<TSnapshot extends SafeSettingsSnapshot = SafeSettingsSnapshot> {
    readonly #subscriptions = new Set<Subscription<TSnapshot, unknown>>()
    readonly #pendingNotifications = new Map<SettingsScope, SettingsChanged>()
    readonly #scopeTails: Record<SettingsScope, Promise<void>> = {
        application: Promise.resolve(),
        project: Promise.resolve(),
    }
    #state?: SettingsSyncState<TSnapshot>
    #starting?: Promise<SettingsSyncState<TSnapshot>>

    constructor(readonly adapter: SettingsSyncAdapter<TSnapshot>) {}

    start(options: {hasProject: boolean}): Promise<SettingsSyncState<TSnapshot>> {
        if (this.#state) return Promise.resolve(this.#state)
        if (this.#starting) return this.#starting
        this.#starting = this.#start(options.hasProject).finally(() => {
            this.#starting = undefined
        })
        return this.#starting
    }

    getState(): SettingsSyncState<TSnapshot> {
        if (!this.#state) throw new Error("SettingsSyncClient has not started")
        return this.#state
    }

    getSnapshot(scope: "application"): Extract<TSnapshot, {scope: "application"}>
    getSnapshot(scope: "project"): Extract<TSnapshot, {scope: "project"}> | undefined
    getSnapshot(scope: SettingsScope): TSnapshot | undefined
    getSnapshot(scope: SettingsScope): TSnapshot | undefined {
        const state = this.getState()
        return scope === "application" ? state.application : state.project
    }

    subscribe<TValue>(
        selector: (state: SettingsSyncState<TSnapshot>) => TValue,
        listener: (value: TValue, previous: TValue | undefined) => void,
        equality: (left: TValue, right: TValue) => boolean = Object.is,
    ): () => void {
        const subscription: Subscription<TSnapshot, TValue> = {
            selector, listener, equality, initialized: false,
        }
        this.#subscriptions.add(subscription as Subscription<TSnapshot, unknown>)
        if (this.#state) this.#publishOne(subscription)
        return () => this.#subscriptions.delete(subscription as Subscription<TSnapshot, unknown>)
    }

    notify(change: SettingsChanged): Promise<void> {
        if (!this.#state) {
            this.#pendingNotifications.set(change.scope, change)
            return Promise.resolve()
        }
        if (!this.#accepts(change)) return Promise.resolve()
        return this.#enqueue(change.scope, () => this.#syncInternal(change.scope, change.revision))
    }

    syncTo(scope: SettingsScope, revision?: string): Promise<void> {
        if (!this.#state) return Promise.reject(new Error("SettingsSyncClient has not started"))
        return this.#enqueue(scope, () => this.#syncInternal(scope, revision))
    }

    mutate(scope: SettingsScope, operations: readonly SettingMutation[]): Promise<MutationResult> {
        if (!this.#state) return Promise.reject(new Error("SettingsSyncClient has not started"))
        if (!this.adapter.save) return Promise.reject(new Error("Settings adapter is read-only"))
        const copied = [...operations]
        return this.#enqueue(scope, () => this.#mutateInternal(scope, copied))
    }

    async #start(hasProject: boolean): Promise<SettingsSyncState<TSnapshot>> {
        const scopes: SettingsScope[] = hasProject ? ["application", "project"] : ["application"]
        const snapshots = await Promise.all(scopes.map((scope) => this.adapter.fetch(scope)))
        const application = snapshots.find((snapshot) => snapshot.scope === "application")
        const project = snapshots.find((snapshot) => snapshot.scope === "project")
        if (!application) throw new Error("Settings adapter did not return an application snapshot")
        assertScope(application, "application")
        if (hasProject && !project) throw new Error("Settings adapter did not return a project snapshot")
        if (project) assertScope(project, "project")
        this.#state = this.#createState(application, project, hasProject)
        this.#publish()

        while (this.#pendingNotifications.size > 0) {
            const pending = [...this.#pendingNotifications.values()]
            this.#pendingNotifications.clear()
            await Promise.all(pending.map((change) => this.notify(change)))
        }
        return this.#state
    }

    #createState(
        application: TSnapshot,
        project: TSnapshot | undefined,
        hasProject: boolean,
    ): SettingsSyncState<TSnapshot> {
        return {
            application: application as Extract<TSnapshot, {scope: "application"}>,
            project: project as Extract<TSnapshot, {scope: "project"}> | undefined,
            effective: computeEffectiveSettings(application as never, project as never),
            hasProject,
        }
    }

    #accepts(change: SettingsChanged): boolean {
        const state = this.getState()
        if (change.scope === "application") return change.projectRoot === null
        return Boolean(state.hasProject && state.project?.projectRoot === change.projectRoot)
    }

    async #syncInternal(scope: SettingsScope, target?: string): Promise<void> {
        const baseline = this.getSnapshot(scope)?.revision
        if (target && baseline === target) return
        let mismatch: string | undefined
        let mismatchCount = 0
        for (let fetches = 1; fetches <= MAX_REFRESH_FETCHES; fetches += 1) {
            const snapshot = await this.adapter.fetch(scope)
            assertScope(snapshot, scope)
            this.#apply(snapshot)
            if (!target || snapshot.revision === target) return
            if (mismatch === snapshot.revision) mismatchCount += 1
            else {
                mismatch = snapshot.revision
                mismatchCount = 1
            }
            const stable = snapshot.revision === baseline ? STABLE_BASELINE_FETCHES : STABLE_CHANGED_FETCHES
            if (mismatchCount >= stable) return
        }
    }

    async #mutateInternal(scope: SettingsScope, operations: readonly SettingMutation[]): Promise<MutationResult> {
        for (let attempt = 1; attempt <= 4; attempt += 1) {
            const snapshot = this.getSnapshot(scope)
            if (!snapshot) throw new Error(`${scope} settings are not loaded`)
            const request = this.#buildSaveRequest(snapshot, operations)
            const result = await this.adapter.save!(request)
            if (result.ok) {
                await this.#syncInternal(scope, result.revision)
                return {ok: true, revision: result.revision, attempts: attempt, conflict: false}
            }
            if (!result.conflict) {
                return {
                    ok: false, revision: result.revision, attempts: attempt, conflict: false,
                    error: result.error ?? "Settings save failed",
                }
            }
            await this.#syncInternal(scope, result.revision || undefined)
        }
        return {
            ok: false,
            revision: this.getSnapshot(scope)?.revision ?? "",
            attempts: 4,
            conflict: true,
            error: "Settings changed externally",
        }
    }

    #buildSaveRequest(snapshot: TSnapshot, operations: readonly SettingMutation[]): SettingsDocumentSaveRequest {
        const documents = applySettingMutations(snapshot, operations)
        return {
            scope: snapshot.scope,
            expectedRevision: snapshot.revision,
            ...(documents.settingsChanged ? {settingsJson: documents.settingsJson} : {}),
            ...(documents.vibeflyChanged ? {vibeflyJson: documents.vibeflyJson} : {}),
        }
    }

    #apply(snapshot: TSnapshot): void {
        const current = this.getState()
        if (snapshot.scope === "application") {
            if (current.application.revision === snapshot.revision) return
            this.#state = this.#createState(snapshot, current.project, current.hasProject)
        } else {
            if (current.project && current.project.projectRoot !== snapshot.projectRoot) {
                throw new Error("Settings adapter returned a snapshot for another project")
            }
            if (current.project?.revision === snapshot.revision) return
            this.#state = this.#createState(current.application, snapshot, current.hasProject)
        }
        this.#publish()
    }

    #publish(): void {
        for (const subscription of this.#subscriptions) this.#publishOne(subscription)
    }

    #publishOne<TValue>(subscription: Subscription<TSnapshot, TValue>): void {
        const selected = subscription.selector(this.getState())
        if (subscription.initialized && subscription.equality(subscription.selected as TValue, selected)) return
        const previous = subscription.initialized ? subscription.selected : undefined
        subscription.selected = selected
        subscription.initialized = true
        subscription.listener(selected, previous)
    }

    #enqueue<T>(scope: SettingsScope, operation: () => Promise<T>): Promise<T> {
        const result = this.#scopeTails[scope].then(operation, operation)
        this.#scopeTails[scope] = result.then(() => undefined, () => undefined)
        return result
    }
}

export function selectSetting<TSnapshot extends SafeSettingsSnapshot, TValue>(key: SettingKey<TValue>) {
    return (state: SettingsSyncState<TSnapshot>): TValue => {
        if (key.readLayer === "application") {
            const source = key.document === "settings"
                ? state.application.settingsJson
                : state.application.vibeflyJson
            const file = key.document === "settings" ? "settings.json" : "settings.vibefly.json"
            let current: unknown = parseJsonObjectDocument(source, file).value
            for (const part of key.path) {
                if (!current || typeof current !== "object" || Array.isArray(current)) return key.decode(undefined)
                current = (current as Record<string, unknown>)[part]
            }
            return key.decode(current as never)
        }
        let current: unknown = key.document === "settings" ? state.effective.settings : state.effective.vibefly
        for (const part of key.path) {
            if (!current || typeof current !== "object" || Array.isArray(current)) return key.decode(undefined)
            current = (current as Record<string, unknown>)[part]
        }
        return key.decode(current as never)
    }
}

export function selectSettings<TSnapshot extends SafeSettingsSnapshot, TTree>(tree: TTree) {
    return (state: SettingsSyncState<TSnapshot>): SettingValuesOf<TTree> => {
        return projectSettingValues(tree, (key) => selectSetting(key)(state))
    }
}
