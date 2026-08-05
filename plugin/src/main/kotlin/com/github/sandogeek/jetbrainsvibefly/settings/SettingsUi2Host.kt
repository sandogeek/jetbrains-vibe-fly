package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.agent.VibeflyAgentDirectory
import com.github.sandogeek.jetbrainsvibefly.agent.VibeflyAgentService
import com.github.sandogeek.vibefly.jcef.rpc.*
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import kotlinx.coroutines.runBlocking
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Settings-panel hosts: shared [Ui2Host] + [Ui2HostSettings].
 *
 * Login reverse-RPC is bridged via [Agent2HostBridge] + optional [Host2UiSettings].
 */
class SettingsUi2Host(
    private val project: Project? = null,
    private val host2UiSettingsProvider: () -> Host2UiSettings? = { null },
) : Ui2Host by Ui2HostImpl(), Ui2HostSettings {

    private val log = logger<SettingsUi2Host>()
    private val activeControl = AtomicReference<Host2Agent?>(null)

    override suspend fun logFromWeb(message: String) {
        log.info("WebView: $message")
    }

    override suspend fun getIdeSettings(): IdeSettingsDto {
        val providers = VibeflyProviderSettingsState.getInstance()
        val commit = VibeflyCommitMessageSettingsState.getInstance()
        val prefs = VibeflyModelPreferencesState.getInstance()
        val ui = VibeflyUiSettingsState.getInstance()
        return IdeSettingsDto(
            providers = ProvidersFormDto(
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
            ui = UiFormDto(
                locale = ui.locale,
            ),
        )
    }

    override suspend fun saveIdeSettings(settings: IdeSettingsDto) {
        val providersState = VibeflyProviderSettingsState.getInstance()
        val commitState = VibeflyCommitMessageSettingsState.getInstance()
        val prefsState = VibeflyModelPreferencesState.getInstance()
        val uiState = VibeflyUiSettingsState.getInstance()

        val prevDefaultProvider = providersState.defaultProvider
        val prevDefaultModel = providersState.defaultModel

        val form = settings.providers
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

        uiState.locale = VibeflyUiSettingsState.normalizeLocale(settings.ui.locale)

        val defaultSpec = providersState.defaultModelSpec()
        if (defaultSpec.isNotEmpty()) {
            prefsState.recordUsed(defaultSpec)
        }
        val commitSpec = commitState.commitModelSpec.trim()
        if (commitSpec.isNotEmpty()) {
            prefsState.recordUsed(commitSpec)
        }

        val providersChanged =
            prevDefaultProvider != providersState.defaultProvider ||
                prevDefaultModel != providersState.defaultModel
        if (providersChanged) {
            // TODO 不要stopAllOpenProjects，而是通知其它project重新getIdeSettings
            VibeflyAgentService.stopAllOpenProjects()
        }
    }

    override suspend fun refreshProviders(): ProvidersRefreshResult {
        val fixedAgentDir = VibeflyAgentDirectory.current()
        val requestId = providerRequestSequence.incrementAndGet()
        val startedAt = System.nanoTime()
        fun elapsedMs(): Long = (System.nanoTime() - startedAt) / 1_000_000L
        log.info("refreshProviders start request=$requestId agentDir=$fixedAgentDir")
        return try {
            val result = ProvidersSettingsLoader.fetch(project)
            log.info(
                "refreshProviders done request=$requestId elapsedMs=${elapsedMs()} " +
                    "providers=${result.snapshot.providers.size}",
            )
            ProvidersRefreshResult(ok = true, snapshot = result.snapshot)
        } catch (e: Exception) {
            log.warn(
                "refreshProviders failed request=$requestId agentDir=$fixedAgentDir " +
                    "elapsedMs=${elapsedMs()}",
                e,
            )
            ProvidersRefreshResult(ok = false, error = e.message ?: e.toString())
        }
    }

    override suspend fun applyProvidersPatch(request: ProvidersPatchRequest): ProvidersPatchResult {
        return try {
            VibeflyAgentService.withControlForSettings(
                project = project,
                operation = "applyProvidersPatch",
            ) { control ->
                control.applyProvidersPatch(request)
            }
        } catch (e: Exception) {
            log.warn("applyProvidersPatch failed", e)
            ProvidersPatchResult(ok = false, error = e.message ?: e.toString())
        }
    }

    override suspend fun loginProvider(request: ProviderLoginRequest): ProviderLoginResult {
        val webUi = WebProviderLoginUi(host2UiSettingsProvider)
        return try {
            Agent2HostBridge.withUi(webUi) {
                VibeflyAgentService.withControlForSettings(
                    project = project,
                    timeoutMs = LOGIN_TIMEOUT_MS,
                    operation = "loginProvider",
                ) { control ->
                    activeControl.set(control)
                    try {
                        control.loginProvider(request)
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
        return try {
            VibeflyAgentService.withControlForSettings(
                project = project,
                operation = "logoutProvider",
            ) { control ->
                control.logoutProvider(request)
            }
        } catch (e: Exception) {
            log.warn("logoutProvider failed", e)
            ProviderLogoutResult(ok = false, error = e.message ?: e.toString())
        }
    }

    companion object {
        private val providerRequestSequence = AtomicLong()

        /** Browser OAuth can wait several minutes for callback. */
        private const val LOGIN_TIMEOUT_MS: Long = 360_000L
    }
}

/**
 * Forwards agent login reverse-RPC into the active settings WebView [Host2UiSettings].
 */
private class WebProviderLoginUi(
    private val host2UiSettingsProvider: () -> Host2UiSettings?,
) : ProviderLoginUi {

    private val log = logger<WebProviderLoginUi>()

    override fun onOpenUrl(request: LoginOpenUrlRequest) {
        val host2Ui = host2UiSettingsProvider()
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
        val host2Ui = host2UiSettingsProvider() ?: return
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
        val host2Ui = host2UiSettingsProvider()
            ?: return LoginInputResponse(text = "", cancelled = true)
        return try {
            host2Ui.requestLoginInput(request.message, request.placeholder)
        } catch (e: Exception) {
            log.warn("requestLoginInput failed", e)
            LoginInputResponse(text = "", cancelled = true)
        }
    }
}
