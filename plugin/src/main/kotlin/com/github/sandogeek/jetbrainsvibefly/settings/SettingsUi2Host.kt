package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.agent.VibeflyAgentService
import com.github.sandogeek.jetbrainsvibefly.util.Edt
import com.github.sandogeek.vibefly.jcef.rpc.Host2Ui
import com.github.sandogeek.vibefly.jcef.rpc.IdeSettingsDto
import com.github.sandogeek.vibefly.jcef.rpc.LoginInputRequest
import com.github.sandogeek.vibefly.jcef.rpc.LoginInputResponse
import com.github.sandogeek.vibefly.jcef.rpc.LoginOpenUrlRequest
import com.github.sandogeek.vibefly.jcef.rpc.ModelPreferencesDto
import com.github.sandogeek.vibefly.jcef.rpc.ProviderLoginRequest
import com.github.sandogeek.vibefly.jcef.rpc.ProviderLoginResult
import com.github.sandogeek.vibefly.jcef.rpc.ProviderLogoutRequest
import com.github.sandogeek.vibefly.jcef.rpc.ProviderLogoutResult
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersFormDto
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersPatchRequest
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersPatchResult
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersRefreshResult
import com.github.sandogeek.vibefly.jcef.rpc.CommitFormDto
import com.github.sandogeek.vibefly.jcef.rpc.Host2Agent
import com.github.sandogeek.vibefly.jcef.rpc.Ui2HostImpl
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import kotlinx.coroutines.runBlocking
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Settings-panel [com.github.sandogeek.vibefly.jcef.rpc.Ui2Host].
 *
 * Methods 1–3 (version / log / agent connection) stay on [Ui2HostImpl] defaults:
 * settings hosts do not open an agent WebSocket ([getAgentConnection] → null).
 *
 * Methods 4–11 implement IDE persistence + providers control proxy + external URL.
 * Login reverse-RPC is bridged via [Agent2HostBridge] + optional [Host2Ui] login callbacks.
 */
class SettingsUi2Host(
    private val project: Project? = null,
    private val host2UiProvider: () -> Host2Ui? = { null },
) : Ui2HostImpl(agentConnectionProvider = null) {

    private val log = logger<SettingsUi2Host>()
    private val activeControl = AtomicReference<Host2Agent?>(null)

    override suspend fun logFromWeb(message: String) {
        log.info("WebView: $message")
    }

    override suspend fun getIdeSettings(): IdeSettingsDto {
        val providers = VibeflyProviderSettingsState.getInstance()
        val commit = VibeflyCommitMessageSettingsState.getInstance()
        val prefs = VibeflyModelPreferencesState.getInstance()
        return IdeSettingsDto(
            providers = ProvidersFormDto(
                agentDir = providers.agentDir,
                defaultProvider = providers.defaultProvider,
                defaultModel = providers.defaultModel,
            ),
            commit = CommitFormDto(
                languageMode = commit.languageMode,
                commitModelSpec = commit.commitModelSpec,
                useCustomPrompt = commit.useCustomPrompt,
                customPrompt = commit.customPrompt,
            ),
            modelPreferences = ModelPreferencesDto(
                recentModelSpecs = prefs.recentModelSpecs.toList(),
                pinnedModelSpecs = prefs.pinnedModelSpecs.toList(),
            ),
        )
    }

    override suspend fun saveIdeSettings(settings: IdeSettingsDto) {
        val providersState = VibeflyProviderSettingsState.getInstance()
        val commitState = VibeflyCommitMessageSettingsState.getInstance()
        val prefsState = VibeflyModelPreferencesState.getInstance()

        val prevAgentDir = providersState.agentDir
        val prevDefaultProvider = providersState.defaultProvider
        val prevDefaultModel = providersState.defaultModel

        val form = settings.providers
        providersState.agentDir = form.agentDir
        providersState.defaultProvider = form.defaultProvider
        providersState.defaultModel = form.defaultModel

        val commit = settings.commit
        commitState.languageMode =
            VibeflyCommitMessageSettingsState.normalizeLanguageMode(commit.languageMode)
        commitState.commitModelSpec = commit.commitModelSpec
        commitState.useCustomPrompt = commit.useCustomPrompt
        commitState.customPrompt = commit.customPrompt

        // Wholesale replace pin/MRU (no separate toggle RPC).
        val prefs = settings.modelPreferences
        prefsState.replace(prefs.recentModelSpecs, prefs.pinnedModelSpecs)

        val defaultSpec = providersState.defaultModelSpec()
        if (defaultSpec.isNotEmpty()) {
            prefsState.recordUsed(defaultSpec)
        }
        val commitSpec = commitState.commitModelSpec.trim()
        if (commitSpec.isNotEmpty()) {
            prefsState.recordUsed(commitSpec)
        }

        val providersChanged =
            prevAgentDir != providersState.agentDir ||
                prevDefaultProvider != providersState.defaultProvider ||
                prevDefaultModel != providersState.defaultModel
        if (providersChanged) {
            // TODO 不要stopAllOpenProjects，而是通知其它project重新getIdeSettings
            VibeflyAgentService.stopAllOpenProjects()
        }
    }

    override suspend fun refreshProviders(agentDir: String): ProvidersRefreshResult {
        val expanded = expandAgentDir(agentDir)
        val requestId = providerRequestSequence.incrementAndGet()
        val startedAt = System.nanoTime()
        fun elapsedMs(): Long = (System.nanoTime() - startedAt) / 1_000_000L
        log.info("refreshProviders start request=$requestId agentDir=$expanded")
        return try {
            val result = ProvidersSettingsLoader.fetch(expanded, project)
            log.info(
                "refreshProviders done request=$requestId elapsedMs=${elapsedMs()} " +
                    "providers=${result.snapshot.providers.size}",
            )
            ProvidersRefreshResult(ok = true, snapshot = result.snapshot)
        } catch (e: Exception) {
            log.warn(
                "refreshProviders failed request=$requestId agentDir=$expanded " +
                    "elapsedMs=${elapsedMs()}",
                e,
            )
            ProvidersRefreshResult(ok = false, error = e.message ?: e.toString())
        }
    }

    override suspend fun applyProvidersPatch(request: ProvidersPatchRequest): ProvidersPatchResult {
        val expanded = expandAgentDir(request.agentDir)
        val effective = request.copy(agentDir = expanded)
        return try {
            VibeflyAgentService.withControlForSettings(
                project = project,
                operation = "applyProvidersPatch",
            ) { control ->
                control.applyProvidersPatch(effective)
            }
        } catch (e: Exception) {
            log.warn("applyProvidersPatch failed", e)
            ProvidersPatchResult(ok = false, error = e.message ?: e.toString())
        }
    }

    override suspend fun loginProvider(request: ProviderLoginRequest): ProviderLoginResult {
        val expanded = expandAgentDir(request.agentDir)
        val effective = request.copy(agentDir = expanded)
        val webUi = WebProviderLoginUi(host2UiProvider)
        return try {
            Agent2HostBridge.withUi(webUi) {
                VibeflyAgentService.withControlForSettings(
                    project = project,
                    timeoutMs = LOGIN_TIMEOUT_MS,
                    operation = "loginProvider",
                ) { control ->
                    activeControl.set(control)
                    try {
                        control.loginProvider(effective)
                    } finally {
                        activeControl.compareAndSet(control, null)
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("loginProvider failed", e)
            ProviderLoginResult(ok = false, error = e.message ?: e.toString())
        }
    }

    override suspend fun cancelProviderLogin() {
        val control = activeControl.get()
        if (control == null) {
            log.debug("cancelProviderLogin: no active control")
            return
        }
        try {
            control.cancelProviderLogin()
        } catch (e: Exception) {
            log.debug("cancelProviderLogin failed", e)
        }
    }

    override suspend fun logoutProvider(request: ProviderLogoutRequest): ProviderLogoutResult {
        val expanded = expandAgentDir(request.agentDir)
        val effective = request.copy(agentDir = expanded)
        return try {
            VibeflyAgentService.withControlForSettings(
                project = project,
                operation = "logoutProvider",
            ) { control ->
                control.logoutProvider(effective)
            }
        } catch (e: Exception) {
            log.warn("logoutProvider failed", e)
            ProviderLogoutResult(ok = false, error = e.message ?: e.toString())
        }
    }

    override suspend fun openExternalUrl(url: String) {
        val target = url.trim()
        if (target.isEmpty()) return
        runOnEdt {
            try {
                BrowserUtil.browse(target)
            } catch (e: Exception) {
                log.warn("BrowserUtil.browse failed for $target", e)
            }
        }
    }

    private fun expandAgentDir(raw: String): String {
        val trimmed = raw.trim()
        return if (trimmed.isEmpty()) {
            VibeflyProviderSettingsState.getInstance().resolvedAgentDir()
        } else {
            VibeflyProviderSettingsState.expandHome(trimmed)
        }
    }

    companion object {
        private val providerRequestSequence = AtomicLong()

        /** Browser OAuth can wait several minutes for callback. */
        private const val LOGIN_TIMEOUT_MS: Long = 360_000L
    }
}

/**
 * Forwards agent login reverse-RPC into the active settings WebView [Host2Ui].
 */
private class WebProviderLoginUi(
    private val host2UiProvider: () -> Host2Ui?,
) : ProviderLoginUi {

    private val log = logger<WebProviderLoginUi>()

    override fun onOpenUrl(request: LoginOpenUrlRequest) {
        val host2Ui = host2UiProvider()
        if (host2Ui == null) {
            val target = request.launchUrl?.takeIf { it.isNotBlank() } ?: request.url
            if (target.isNotBlank()) {
                try {
                    BrowserUtil.browse(target)
                } catch (e: Exception) {
                    log.warn("BrowserUtil.browse fallback failed for $target", e)
                }
            }
            return
        }
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                runBlocking {
                    host2Ui.loginOpenUrl(request.url, request.launchUrl)
                }
            } catch (e: Exception) {
                log.warn("loginOpenUrl failed", e)
            }
        }
    }

    override fun onProgress(message: String) {
        val host2Ui = host2UiProvider() ?: return
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                runBlocking {
                    host2Ui.loginProgress(message)
                }
            } catch (e: Exception) {
                log.debug("loginProgress failed", e)
            }
        }
    }

    override suspend fun requestInput(request: LoginInputRequest): LoginInputResponse {
        val host2Ui = host2UiProvider()
            ?: return LoginInputResponse(text = "", cancelled = true)
        return try {
            host2Ui.requestLoginInput(request.message, request.placeholder)
        } catch (e: Exception) {
            log.warn("requestLoginInput failed", e)
            LoginInputResponse(text = "", cancelled = true)
        }
    }
}

private suspend fun <T> runOnEdt(block: () -> T): T = Edt.run(block)
