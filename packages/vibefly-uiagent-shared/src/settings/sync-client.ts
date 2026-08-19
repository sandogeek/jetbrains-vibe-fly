import {
    computeEffectiveSettings,
    type EffectiveSettings,
    type SafeSettingsSnapshot,
    type SettingsDiagnostic,
    type SettingsFileName,
    type SettingsScope,
} from "./schema.js"
import {type AnySettingKey, projectSettingValues, type SettingKey, type SettingValuesOf} from "./keys.js"
import {applySettingMutations, type SettingMutation} from "./mutation.js"
import {
    defaultWriteScope,
    fileRevision,
    resolveSettingSource,
    sameFileRevisions,
    type SettingSource,
    settingDocumentFile,
    type SettingsChangedNotification,
    type SettingsFileChange,
} from "./protocol.js"

export type SettingsDocumentSaveRequest = {
    scope: SettingsScope
    document: SettingsFileName
    json: string
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
    sequence: number
}

export type MutationResult = {
    ok: boolean
    revisions: Partial<Record<SettingsFileName, string>>
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

function fileQueueKey(scope: SettingsScope, document: SettingsFileName): string {
    return `${scope}:${document}`
}

function assertScope(snapshot: SafeSettingsSnapshot, expected: SettingsScope): void {
    if (snapshot.scope !== expected) throw new Error(`Expected ${expected} settings snapshot`)
    if (snapshot.scope === "application" && snapshot.projectRoot !== null) {
        throw new Error("Application settings snapshot must have a null projectRoot")
    }
    if (snapshot.scope === "project" && !snapshot.projectRoot.trim()) {
        throw new Error("Project settings snapshot must have a projectRoot")
    }
}

function replaceFileDiagnostics(
    current: readonly SettingsDiagnostic[],
    incoming: readonly SettingsDiagnostic[],
    document: SettingsFileName,
): SettingsDiagnostic[] {
    return [
        ...current.filter((item) => item.file !== document),
        ...incoming.filter((item) => item.file === document),
    ]
}

function overlaySnapshotFile<TSnapshot extends SafeSettingsSnapshot>(
    current: TSnapshot,
    incoming: TSnapshot,
    document: SettingsFileName,
): TSnapshot {
    const next = {
        ...current,
        settingsJson: document === "settings.json" ? incoming.settingsJson : current.settingsJson,
        vibeflyJson: document === "settings.vibefly.json" ? incoming.vibeflyJson : current.vibeflyJson,
        revisions: {
            ...current.revisions,
            [document]: incoming.revisions[document] ?? current.revisions[document],
        },
        diagnostics: replaceFileDiagnostics(current.diagnostics, incoming.diagnostics, document),
    } as TSnapshot
    if (document === "models.json" && "modelsJson" in incoming) {
        (next as TSnapshot & {modelsJson?: string}).modelsJson =
            (incoming as TSnapshot & {modelsJson?: string}).modelsJson
    }
    if (document === "auth.json" && "authJson" in incoming) {
        (next as TSnapshot & {authJson?: string}).authJson =
            (incoming as TSnapshot & {authJson?: string}).authJson
    }
    return next
}

function mutationDocument(mutation: SettingMutation): SettingsFileName {
    return settingDocumentFile(mutation.key.document)
}

export class SettingsSyncClient<TSnapshot extends SafeSettingsSnapshot = SafeSettingsSnapshot> {
    readonly #subscriptions = new Set<Subscription<TSnapshot, unknown>>()
    readonly #pendingNotifications = new Map<string, SettingsFileChange>()
    readonly #fileTails = new Map<string, Promise<void>>()
    #state?: SettingsSyncState<TSnapshot>
    #starting?: Promise<SettingsSyncState<TSnapshot>>
    #sequence = 0

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

    get sequence(): number {
        return this.#state?.sequence ?? 0
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

    notify(change: SettingsChangedNotification | SettingsFileChange): Promise<void> {
        const changes = "changes" in change ? change.changes : [change]
        if (!this.#state) {
            for (const item of changes) {
                this.#pendingNotifications.set(fileQueueKey(item.scope, item.document), item)
            }
            return Promise.resolve()
        }
        return Promise.all(
            changes
                .filter((item) => this.#accepts(item))
                .map((item) => this.#enqueue(item.scope, item.document, () => {
                    return this.#syncFile(item.scope, item.document, item.revision)
                })),
        ).then(() => undefined)
    }

    syncTo(scope: SettingsScope, document?: SettingsFileName, revision?: string): Promise<void> {
        if (!this.#state) return Promise.reject(new Error("SettingsSyncClient has not started"))
        if (document) {
            return this.#enqueue(scope, document, () => this.#syncFile(scope, document, revision))
        }
        const snapshot = this.getSnapshot(scope)
        const documents = Object.keys(snapshot?.revisions ?? {
            "settings.json": "",
            "settings.vibefly.json": "",
        }) as SettingsFileName[]
        return Promise.all(
            documents.map((file) => this.#enqueue(scope, file, () => this.#syncFile(scope, file, revision))),
        ).then(() => undefined)
    }

    mutate(scope: SettingsScope, operations: readonly SettingMutation[]): Promise<MutationResult> {
        if (!this.#state) return Promise.reject(new Error("SettingsSyncClient has not started"))
        if (!this.adapter.save) return Promise.reject(new Error("Settings adapter is read-only"))
        const copied = [...operations]
        const byDocument = new Map<SettingsFileName, SettingMutation[]>()
        for (const operation of copied) {
            const document = mutationDocument(operation)
            const group = byDocument.get(document) ?? []
            group.push(operation)
            byDocument.set(document, group)
        }
        return this.#mutateDocuments(scope, byDocument)
    }

    resolveSource(key: AnySettingKey): SettingSource {
        const state = this.getState()
        return resolveSettingSource(state.application, state.project, key)
    }

    resolveWriteScope(key: AnySettingKey): SettingsScope {
        return defaultWriteScope(this.resolveSource(key))
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
            await this.notify({changes: pending})
        }
        return this.#state
    }

    #createState(
        application: TSnapshot,
        project: TSnapshot | undefined,
        hasProject: boolean,
        sequence = this.#sequence,
    ): SettingsSyncState<TSnapshot> {
        return {
            application: application as Extract<TSnapshot, {scope: "application"}>,
            project: project as Extract<TSnapshot, {scope: "project"}> | undefined,
            effective: computeEffectiveSettings(application as never, project as never),
            hasProject,
            sequence,
        }
    }

    #accepts(change: SettingsFileChange): boolean {
        const state = this.getState()
        if (change.scope === "application") return change.projectRoot === null
        return Boolean(state.hasProject && state.project?.projectRoot === change.projectRoot)
    }

    async #syncFile(
        scope: SettingsScope,
        document: SettingsFileName,
        target?: string,
    ): Promise<void> {
        const baseline = fileRevision(this.getSnapshot(scope)?.revisions, document)
        if (target && baseline === target) return
        let mismatch: string | undefined
        let mismatchCount = 0
        for (let fetches = 1; fetches <= MAX_REFRESH_FETCHES; fetches += 1) {
            const snapshot = await this.adapter.fetch(scope)
            assertScope(snapshot, scope)
            this.#applySnapshot(snapshot)
            const current = fileRevision(snapshot.revisions, document)
            if (!target || current === target) return
            if (mismatch === current) mismatchCount += 1
            else {
                mismatch = current
                mismatchCount = 1
            }
            const stable = current === baseline ? STABLE_BASELINE_FETCHES : STABLE_CHANGED_FETCHES
            if (mismatchCount >= stable) return
        }
    }

    async #mutateDocuments(
        scope: SettingsScope,
        byDocument: Map<SettingsFileName, SettingMutation[]>,
    ): Promise<MutationResult> {
        const revisions: Partial<Record<SettingsFileName, string>> = {}
        let attempts = 0
        for (const [document, operations] of byDocument) {
            const result = await this.#enqueue(scope, document, () => {
                return this.#mutateFile(scope, document, operations)
            })
            attempts = Math.max(attempts, result.attempts)
            if (result.ok) {
                const savedRevision = result.revisions[document]
                if (savedRevision) revisions[document] = savedRevision
                continue
            }
            return {
                ok: false,
                revisions: {...revisions, ...result.revisions},
                attempts,
                conflict: result.conflict,
                error: result.error,
            }
        }
        return {ok: true, revisions, attempts: Math.max(attempts, 1), conflict: false}
    }

    async #mutateFile(
        scope: SettingsScope,
        document: SettingsFileName,
        operations: readonly SettingMutation[],
    ): Promise<MutationResult> {
        for (let attempt = 1; attempt <= 4; attempt += 1) {
            const snapshot = this.getSnapshot(scope)
            if (!snapshot) throw new Error(`${scope} settings are not loaded`)
            const request = this.#buildSaveRequest(snapshot, document, operations)
            const result = await this.adapter.save!(request)
            if (result.ok) {
                await this.#syncFile(scope, document, result.revision)
                return {
                    ok: true,
                    revisions: {[document]: result.revision},
                    attempts: attempt,
                    conflict: false,
                }
            }
            if (!result.conflict) {
                return {
                    ok: false,
                    revisions: {[document]: result.revision},
                    attempts: attempt,
                    conflict: false,
                    error: result.error ?? "Settings save failed",
                }
            }
            await this.#syncFile(scope, document, result.revision || undefined)
        }
        return {
            ok: false,
            revisions: {
                [document]: fileRevision(this.getSnapshot(scope)?.revisions, document),
            },
            attempts: 4,
            conflict: true,
            error: "Settings changed externally",
        }
    }

    #buildSaveRequest(
        snapshot: TSnapshot,
        document: SettingsFileName,
        operations: readonly SettingMutation[],
    ): SettingsDocumentSaveRequest {
        const documents = applySettingMutations(snapshot, operations)
        const json = document === "settings.json" ? documents.settingsJson : documents.vibeflyJson
        return {
            scope: snapshot.scope,
            document,
            json,
            expectedRevision: fileRevision(snapshot.revisions, document),
        }
    }

    #applySnapshot(snapshot: TSnapshot): void {
        const current = this.getState()
        if (snapshot.scope === "application") {
            if (sameFileRevisions(current.application.revisions, snapshot.revisions)
                && current.application.settingsJson === snapshot.settingsJson
                && current.application.vibeflyJson === snapshot.vibeflyJson) {
                return
            }
            this.#state = this.#createState(snapshot, current.project, current.hasProject)
        } else {
            if (current.project && current.project.projectRoot !== snapshot.projectRoot) {
                throw new Error("Settings adapter returned a snapshot for another project")
            }
            if (current.project
                && sameFileRevisions(current.project.revisions, snapshot.revisions)
                && current.project.settingsJson === snapshot.settingsJson
                && current.project.vibeflyJson === snapshot.vibeflyJson) {
                return
            }
            this.#state = this.#createState(current.application, snapshot, current.hasProject)
        }
        this.#publish()
    }

    #publish(): void {
        if (!this.#state) return
        this.#sequence += 1
        this.#state = {...this.#state, sequence: this.#sequence}
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

    #enqueue<T>(
        scope: SettingsScope,
        document: SettingsFileName,
        operation: () => Promise<T>,
    ): Promise<T> {
        const key = fileQueueKey(scope, document)
        const previous = this.#fileTails.get(key) ?? Promise.resolve()
        const result = previous.then(operation, operation)
        this.#fileTails.set(key, result.then(() => undefined, () => undefined))
        return result
    }
}

export function selectSetting<TSnapshot extends SafeSettingsSnapshot, TValue>(key: SettingKey<TValue>) {
    return (state: SettingsSyncState<TSnapshot>): TValue => {
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
