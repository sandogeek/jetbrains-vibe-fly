/** Host-backed API-key writes that share the same credential store as OAuth login. */
import {OAUTH_API_KEY_CONFLICT_ERROR} from "@vibefly/uiagent-shared/agent"
import type {Credential} from "@earendil-works/pi-ai"
import type {ProviderApiKeyRequest, ProviderApiKeyResult} from "./generated/controlRpc.js"
import {log} from "./log.js"
import {getPiRuntime, type PiRuntime} from "./piRuntime.js"

export async function setProviderApiKey(
    request: ProviderApiKeyRequest,
    runtimeInput?: PiRuntime,
): Promise<ProviderApiKeyResult> {
    const providerId = request.providerId.trim()
    const apiKey = request.apiKey.trim()
    if (!providerId) return {ok: false, error: "Provider id is required"}
    if (!apiKey) return {ok: false, error: "API key is required"}

    const runtime = runtimeInput ?? await getPiRuntime()
    try {
        await runtime.auth.modify(providerId, async (current) => {
            if (current?.type === "oauth") {
                throw new Error(OAUTH_API_KEY_CONFLICT_ERROR)
            }
            if (current?.type === "api_key") {
                return {
                    ...current,
                    type: "api_key",
                    key: apiKey,
                } as Credential
            }
            return {type: "api_key", key: apiKey}
        })
        log.info("setProviderApiKey ok", {providerId})
        return {ok: true}
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("setProviderApiKey failed", {providerId, err: message})
        return {ok: false, error: message}
    }
}

