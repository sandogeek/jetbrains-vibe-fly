/** pi provider login bridge for JetBrains Settings. */
import {rpcOptions} from "@sandogeek/simple-rpc"
import type {AuthEvent, AuthInteraction, AuthPrompt} from "@earendil-works/pi-ai"
import type {
  Agent2Host,
  LoginProvidersList,
  ProviderLoginRequest,
  ProviderLoginResult,
  ProviderLogoutRequest,
  ProviderLogoutResult,
} from "./generated/controlRpc.js"
import {log} from "./log.js"
import {resolveLoginProviderId} from "./loginProviders.js"
import {getPiRuntime, type PiRuntime} from "./piRuntime.js"
import {getProvidersSnapshot} from "./providerConfig.js"

const loginUiOpts = rpcOptions({ timeoutMs: 0 })

export type LoginUi = Pick<
  Agent2Host,
  "openLoginUrl" | "requestLoginInput" | "reportLoginProgress"
>

export { providerSupportsLogin, resolveLoginProviderId } from "./loginProviders.js"

let activeLoginAbort: AbortController | null = null

export function cancelActiveLogin(): void {
  activeLoginAbort?.abort()
}

function supportsLogin(provider: {
  auth: { oauth?: unknown; apiKey?: { login?: unknown } }
}): boolean {
  return Boolean(provider.auth.oauth || provider.auth.apiKey?.login)
}

function loginType(provider: {
  auth: { oauth?: unknown; apiKey?: { login?: unknown } }
}): "oauth" | "api_key" {
  return provider.auth.oauth ? "oauth" : "api_key"
}

export async function getLoginProviders(
    runtimeInput?: PiRuntime,
): Promise<LoginProvidersList> {
    const runtime = runtimeInput ?? await getPiRuntime()
  const providers = []
  for (const provider of runtime.modelRuntime.getProviders()) {
    if (!supportsLogin(provider)) continue
    const status = await runtime.modelRuntime.checkAuth(provider.id)
    providers.push({
      id: provider.id,
      name: provider.name,
      available: true,
      storeCredentialsAs: null,
      authenticated: status != null,
    })
  }
  return { providers }
}

function notifyLoginEvent(event: AuthEvent, ui: LoginUi): void {
  if (event.type === "auth_url") {
    void ui
      .openLoginUrl(
        {
          url: event.url,
          launchUrl: event.url,
          instructions: event.instructions ?? null,
        },
        loginUiOpts,
      )
      .catch((error) => log.warn("openLoginUrl failed", { err: error }))
    return
  }
  if (event.type === "device_code") {
    void ui
      .openLoginUrl(
        {
          url: event.verificationUri,
          launchUrl: event.verificationUri,
          instructions: `Enter code ${event.userCode}`,
        },
        loginUiOpts,
      )
      .catch((error) => log.warn("openLoginUrl failed", { err: error }))
    return
  }
  const message = event.type === "progress" || event.type === "info"
    ? event.message
    : ""
  if (message) void ui.reportLoginProgress(message, loginUiOpts).catch(() => {})
}

async function promptForLogin(prompt: AuthPrompt, ui: LoginUi, abort: AbortController): Promise<string> {
  const options = prompt.type === "select"
    ? `\n${prompt.options.map((option, index) => `${index + 1}. ${option.label}`).join("\n")}`
    : ""
  const response = await ui.requestLoginInput(
    {
      message: `${prompt.message}${options}`,
      placeholder: prompt.type === "select" ? "Enter a choice" : prompt.placeholder ?? null,
      allowEmpty: false,
    },
    loginUiOpts,
  )
  if (response.cancelled) {
    abort.abort()
    throw new Error("Login cancelled")
  }
  const value = response.text ?? ""
  if (prompt.type === "select") {
    const index = Number.parseInt(value, 10) - 1
    if (Number.isInteger(index) && index >= 0 && index < prompt.options.length) {
      return prompt.options[index]!.id
    }
  }
  return value
}

export async function loginProvider(
  request: ProviderLoginRequest,
  ui: LoginUi,
  runtimeInput?: PiRuntime,
): Promise<ProviderLoginResult> {
  const providerId = request.providerId.trim()
  if (!providerId) return { ok: false, error: "Provider id is required" }
  const loginId = resolveLoginProviderId(providerId) ?? providerId
    const runtime = runtimeInput ?? await getPiRuntime()
  const provider = runtime.modelRuntime.getProvider(loginId)
  if (!provider || !supportsLogin(provider)) {
    return { ok: false, error: `Unknown login provider: ${providerId}` }
  }

  const abort = new AbortController()
  activeLoginAbort = abort
  try {
    await ui.reportLoginProgress(`Starting login for ${provider.name}...`, loginUiOpts).catch(() => {})
    const interaction: AuthInteraction = {
      signal: abort.signal,
      prompt: (prompt) => promptForLogin(prompt, ui, abort),
      notify: (event) => notifyLoginEvent(event, ui),
    }
    const credential = await runtime.modelRuntime.login(
      loginId,
      loginType(provider),
      interaction,
    )
      const snapshot = await getProvidersSnapshot(runtime)
    log.info("loginProvider ok", { providerId: loginId, identityType: credential.type })
    if (credential.type === "api_key") {
      return { ok: true, identityType: "api_key", snapshot }
    }
    return {
      ok: true,
      identityType: "oauth",
      email: typeof credential.email === "string" ? credential.email : null,
      accountId: typeof credential.accountId === "string" ? credential.accountId : null,
      orgId: typeof credential.orgId === "string" ? credential.orgId : null,
      orgName: typeof credential.orgName === "string" ? credential.orgName : null,
      snapshot,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn("loginProvider failed", { providerId: loginId, err: message })
    return { ok: false, error: message }
  } finally {
    if (activeLoginAbort === abort) activeLoginAbort = null
  }
}

export async function logoutProvider(
  request: ProviderLogoutRequest,
  runtimeInput?: PiRuntime,
): Promise<ProviderLogoutResult> {
  const providerId = request.providerId.trim()
  if (!providerId) return { ok: false, error: "Provider id is required" }
    const runtime = runtimeInput ?? await getPiRuntime()
  const loginId = resolveLoginProviderId(providerId) ?? providerId
  try {
    await runtime.modelRuntime.logout(loginId)
    if (providerId !== loginId) await runtime.modelRuntime.logout(providerId)
      const snapshot = await getProvidersSnapshot(runtime)
    log.info("logoutProvider ok", { providerId, loginId })
    return { ok: true, snapshot }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn("logoutProvider failed", { providerId, err: message })
    return { ok: false, error: message }
  }
}
