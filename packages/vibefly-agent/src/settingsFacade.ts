import {
    type Agent2Ui,
    type AgentSettingsInvalidation,
    defaultWriteScope,
    fileRevision,
    requireSettingKey,
    resolveSettingSource,
    selectSetting,
    setSetting,
    type SettingMutation,
    type SettingMutationRequest,
    type SettingMutationResult,
    type SettingValueResult,
    settingDocumentFile,
    unsetSetting,
} from "@vibefly/uiagent-shared"
import {log} from "./log.js"
import type {HostSettingsRuntime} from "./hostSettings.js"

export class SettingsUiHub {
    readonly #connections = new Set<Agent2Ui>()
    #lastInvalidation: AgentSettingsInvalidation | undefined

    add(ui: Agent2Ui): () => void {
        this.#connections.add(ui)
        return () => {
            this.#connections.delete(ui)
        }
    }

    get size(): number {
        return this.#connections.size
    }

    broadcast(change: AgentSettingsInvalidation): void {
        this.#lastInvalidation = change
        for (const ui of this.#connections) {
            void ui.settingsInvalidated(change).catch((error) => {
                log.debug("settingsInvalidated delivery failed", {err: error})
            })
        }
    }
}

export class AgentSettingsFacade {
    readonly hub = new SettingsUiHub()

    constructor(private readonly runtime: HostSettingsRuntime) {}

    readSettingValues(keyIds: string[]): SettingValueResult[] {
        const state = this.runtime.snapshots.getState()
        const sequence = state.sequence
        return keyIds.map((keyId) => {
            const key = requireSettingKey(keyId)
            const value = selectSetting(key)(state)
            const source = resolveSettingSource(state.application, state.project, key)
            const document = settingDocumentFile(key.document)
            return {
                keyId,
                value,
                source,
                document,
                revisions: {
                    application: fileRevision(state.application.revisions, document),
                    project: state.project ? fileRevision(state.project.revisions, document) : null,
                },
                sequence,
            }
        })
    }

    async mutateSettings(request: SettingMutationRequest): Promise<SettingMutationResult> {
        try {
            const byScope = new Map<"application" | "project", SettingMutation[]>()
            for (const operation of request.operations) {
                const key = requireSettingKey(operation.keyId)
                const source = this.runtime.snapshots.resolveSource(key)
                const scope = operation.targetScope ?? defaultWriteScope(source)
                if (scope === "project" && !this.runtime.snapshots.getState().hasProject) {
                    throw new Error("Project settings are not available")
                }
                const mutation: SettingMutation = operation.kind === "set"
                    ? setSetting(key, key.decode(operation.value as never))
                    : unsetSetting(key)
                const group = byScope.get(scope) ?? []
                group.push(mutation)
                byScope.set(scope, group)
            }

            for (const [scope, operations] of byScope) {
                const result = await this.runtime.snapshots.mutate(scope, operations)
                if (!result.ok) {
                    return {
                        ok: false,
                        clientMutationId: request.clientMutationId,
                        conflict: result.conflict,
                        error: result.error,
                    }
                }
            }

            await this.runtime.refreshFromHost()
            const state = this.runtime.snapshots.getState()
            const affected = [...new Set(request.operations.map((operation) => {
                return settingDocumentFile(requireSettingKey(operation.keyId).document)
            }))]
            this.hub.broadcast({
                changes: affected.map((document) => ({
                    scope: "application",
                    document,
                    revision: fileRevision(state.application.revisions, document),
                })),
                sequence: state.sequence,
            })
            return {ok: true, clientMutationId: request.clientMutationId}
        } catch (error) {
            return {
                ok: false,
                clientMutationId: request.clientMutationId,
                error: error instanceof Error ? error.message : String(error),
            }
        }
    }

    notifyFromHost(raw: {
        changes?: Array<{
            scope?: string
            projectRoot?: string | null
            document?: string
            revision?: string
        }> | null
    }): Promise<void> {
        return this.runtime.handleSettingsChanged(raw).then(() => {
            const state = this.runtime.snapshots.getState()
            const changes = (raw.changes ?? []).flatMap((item) => {
                if (item.scope !== "application" && item.scope !== "project") return []
                if (!item.document) return []
                return [{
                    scope: item.scope as "application" | "project",
                    document: item.document as AgentSettingsInvalidation["changes"][number]["document"],
                    revision: String(item.revision ?? ""),
                }]
            })
            if (changes.length === 0) return
            this.hub.broadcast({changes, sequence: state.sequence})
        })
    }
}
