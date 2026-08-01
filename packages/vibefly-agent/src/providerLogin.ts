/**
 * Oh My Pi AuthStorage.login / logout bridge for JetBrains Settings.
 * Interactive callbacks go through Agent2Host reverse RPC.
 */
import { getOAuthProviders } from "@oh-my-pi/pi-ai/oauth"
import type { OAuthProviderId } from "@oh-my-pi/pi-ai/oauth"
import { setAgentDir } from "@oh-my-pi/pi-utils"
import { rpcOptions } from "@sandogeek/simple-rpc"
import type {
  Agent2Host,
  LoginProvidersList,
  ProviderLoginRequest,
  ProviderLoginResult,
  ProviderLogoutRequest,
  ProviderLogoutResult,
} from "./generated/controlRpc.js"
import { log } from "./log.js"
import { resolveLoginProviderId } from "./loginProviders.js"
import {
  getProvidersSnapshot,
  openAuthStorage,
  resolveAgentDir,
} from "./providerConfig.js"

/** Long-lived reverse calls (user may paste a code after several minutes). */
const loginUiOpts = rpcOptions({ timeoutMs: 0 })

export type LoginUi = Pick<
  Agent2Host,
  "openLoginUrl" | "requestLoginInput" | "reportLoginProgress"
>

export { providerSupportsLogin, resolveLoginProviderId } from "./loginProviders.js"

/** In-flight login abort (host cancel / dialog close). */
let activeLoginAbort: AbortController | null = null

export function cancelActiveLogin(): void {
  activeLoginAbort?.abort()
}

export async function getLoginProviders(
  agentDirInput?: string | null,
): Promise<LoginProvidersList> {
  const agentDir = resolveAgentDir(agentDirInput)
  setAgentDir(agentDir)
  const auth = await openAuthStorage(agentDir)
  try {
    const providers = getOAuthProviders().map((p) => {
      const storeId = p.storeCredentialsAs ?? p.id
      return {
        id: p.id,
        name: p.name,
        available: p.available !== false,
        storeCredentialsAs: p.storeCredentialsAs ?? null,
        authenticated: auth.hasAuth(storeId) || auth.hasAuth(p.id),
      }
    })
    return { providers }
  } finally {
    auth.close()
  }
}

export async function loginProvider(
  request: ProviderLoginRequest,
  ui: LoginUi,
): Promise<ProviderLoginResult> {
  const providerId = request.providerId.trim()
  if (!providerId) {
    return { ok: false, error: "Provider id is required" }
  }
  const loginId = resolveLoginProviderId(providerId) ?? providerId
  const known = getOAuthProviders().find((p) => p.id === loginId)
  if (!known) {
    return {
      ok: false,
      error: `Unknown login provider: ${providerId}`,
    }
  }

  const agentDir = resolveAgentDir()
  setAgentDir(agentDir)
  const auth = await openAuthStorage(agentDir)
  const abort = new AbortController()
  activeLoginAbort = abort

  try {
    await ui
      .reportLoginProgress(`Starting login for ${known.name}…`, loginUiOpts)
      .catch(() => {})

    const identity = await auth.login(loginId as OAuthProviderId, {
      signal: abort.signal,
      onAuth: (info) => {
        void ui
          .openLoginUrl(
            {
              url: info.url,
              launchUrl: info.launchUrl ?? null,
              instructions: info.instructions ?? null,
            },
            loginUiOpts,
          )
          .catch((err) => {
            log.warn("openLoginUrl failed", { err })
          })
      },
      onProgress: (message) => {
        void ui.reportLoginProgress(message, loginUiOpts).catch(() => {})
      },
      onPrompt: async (prompt) => {
        const allowEmpty =
          "allowEmpty" in prompt && (prompt as { allowEmpty?: boolean }).allowEmpty === true
        const response = await ui.requestLoginInput(
          {
            message: prompt.message,
            placeholder: prompt.placeholder ?? null,
            allowEmpty,
          },
          loginUiOpts,
        )
        if (response.cancelled) {
          abort.abort()
          throw new Error("Login cancelled")
        }
        return response.text ?? ""
      },
    })

    const snapshot = await getProvidersSnapshot(agentDir)
    log.info("loginProvider ok", {
      providerId: loginId,
      identityType: identity?.type ?? "none",
    })
    if (!identity) {
      return {
        ok: true,
        identityType: "none",
        snapshot,
      }
    }
    if (identity.type === "api_key") {
      return {
        ok: true,
        identityType: "api_key",
        snapshot,
      }
    }
    return {
      ok: true,
      identityType: "oauth",
      email: identity.email ?? null,
      accountId: identity.accountId ?? null,
      orgId: identity.orgId ?? null,
      orgName: identity.orgName ?? null,
      snapshot,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn("loginProvider failed", { providerId: loginId, err: message })
    return { ok: false, error: message }
  } finally {
    if (activeLoginAbort === abort) {
      activeLoginAbort = null
    }
    auth.close()
  }
}

export async function logoutProvider(
  request: ProviderLogoutRequest,
): Promise<ProviderLogoutResult> {
  const providerId = request.providerId.trim()
  if (!providerId) {
    return { ok: false, error: "Provider id is required" }
  }
  const agentDir = resolveAgentDir()
  setAgentDir(agentDir)
  const auth = await openAuthStorage(agentDir)
  try {
    // Logout both login id and storeCredentialsAs target.
    const loginId = resolveLoginProviderId(providerId) ?? providerId
    const storeAs =
      getOAuthProviders().find((p) => p.id === loginId)?.storeCredentialsAs
    await auth.logout(loginId)
    if (storeAs && storeAs !== loginId) {
      await auth.logout(storeAs)
    }
    if (providerId !== loginId) {
      await auth.logout(providerId)
    }
    const snapshot = await getProvidersSnapshot(agentDir)
    log.info("logoutProvider ok", { providerId, loginId })
    return { ok: true, snapshot }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn("logoutProvider failed", { providerId, err: message })
    return { ok: false, error: message }
  } finally {
    auth.close()
  }
}
