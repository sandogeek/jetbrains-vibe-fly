package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.agent.VibeflyAgentService
import com.github.sandogeek.vibefly.jcef.rpc.*
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import kotlinx.coroutines.*
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Settings-panel hosts: shared [Ui2Host] + [Ui2HostSettings].
 *
 * Login reverse-RPC is bridged via [Agent2HostBridge] + optional [Host2UiSettings].
 */
class SettingsUi2Host(
    private val project: Project,
    private val host2UiProvider: () -> Host2Ui? = { null },
    private val host2UiSettingsProvider: () -> Host2UiSettings? = { null },
) : Ui2Host by Ui2HostImpl(), Ui2HostSettings, Disposable {

    private val log = logger<SettingsUi2Host>()
    private val activeControl = AtomicReference<Host2Agent?>(null)
    private val settingsNotificationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val boundProjectRoot = project
        .takeUnless(Project::isDisposed)
        ?.let(VibeflyProjectSettingsService::getInstance)
        ?.projectRoot

    init {
        VibeflyApplicationSettingsService.getInstance()
        ApplicationManager.getApplication().messageBus
            .connect(this)
            .subscribe(
                VIBEFLY_SETTINGS_TOPIC,
                VibeflySettingsListener(::forwardSettingsChanged),
            )
    }

    override suspend fun logFromWeb(message: String) {
        log.info("WebView: $message")
    }

    override suspend fun getSettingsSnapshot(scope: String): UiSettingsSnapshot =
        SettingsHostAccess.uiSnapshot(scope, project)

    override suspend fun saveSettings(request: SettingsSaveRequest): SettingsSaveResult =
        SettingsHostAccess.saveSettings(request, project)

    override suspend fun refreshProviders(): ProvidersRefreshResult {
        val requestId = providerRequestSequence.incrementAndGet()
        val startedAt = System.nanoTime()
        fun elapsedMs(): Long = (System.nanoTime() - startedAt) / 1_000_000L
        log.info("refreshProviders start request=$requestId")
        return try {
            val application = VibeflyApplicationSettingsService.getInstance()
            val settings = application.snapshot(refresh = true)
            val snapshot = VibeflyAgentService.getInstance(project).withControl { control ->
                control.getProvidersSnapshot(
                    settings.content(SettingsDocument.MODELS),
                    settings.content(SettingsDocument.AUTH),
                )
            }
            log.info(
                "refreshProviders done request=$requestId elapsedMs=${elapsedMs()} " +
                        "providers=${snapshot.providers.size}",
            )
            ProvidersRefreshResult(
                ok = true,
                snapshot = snapshot,
                revision = settings.revision,
            )
        } catch (e: Exception) {
            log.warn(
                "refreshProviders failed request=$requestId elapsedMs=${elapsedMs()}",
                e,
            )
            ProvidersRefreshResult(ok = false, error = e.message ?: e.toString())
        }
    }

    override suspend fun applyProvidersPatch(
        request: ProvidersPatchRequest,
        expectedRevision: String,
    ): ProvidersPatchResult {
        val application = VibeflyApplicationSettingsService.getInstance()
        val current = application.snapshot(refresh = true)
        revisionConflict(current, expectedRevision)?.let { return it }

        val patched = try {
            VibeflyAgentService.getInstance(project).withControl { control ->
                control.applyProvidersPatch(
                    request,
                    current.content(SettingsDocument.MODELS),
                )
            }
        } catch (error: Exception) {
            log.warn("applyProvidersPatch agent transform failed", error)
            return ProvidersPatchResult(ok = false, error = error.message ?: error.toString())
        }
        if (!patched.ok) {
            return ProvidersPatchResult(
                ok = false,
                error = patched.error ?: "Invalid provider config patch",
                revision = current.revision,
            )
        }

        if (patched.modelsChanged && patched.modelsJson == null) {
            return ProvidersPatchResult(
                ok = false,
                error = "Agent omitted modelsJson for a models change",
                revision = current.revision,
            )
        }

        return persistProviderDocuments(
            modelsJson = if (patched.modelsChanged) patched.modelsJson else null,
            authJson = null,
            expectedRevision = expectedRevision,
        )
    }

    override suspend fun loginProvider(request: ProviderLoginRequest): ProviderLoginResult {
        val webUi = WebProviderLoginUi(host2UiSettingsProvider)
        return try {
            Agent2HostBridge.withUi(webUi) {
                VibeflyAgentService.getInstance(project).withControl(
                    timeoutMs = LOGIN_TIMEOUT_MS,
                ) { control ->
                    activeControl.set(control)
                    try {
                        control.loginProvider(request).withHostSnapshot(control)
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
            VibeflyAgentService.getInstance(project).withControl { control ->
                control.logoutProvider(request).withHostSnapshot(control)
            }
        } catch (e: Exception) {
            log.warn("logoutProvider failed", e)
            ProviderLogoutResult(ok = false, error = e.message ?: e.toString())
        }
    }

    override suspend fun setProviderApiKey(request: ProviderApiKeyRequest): ProvidersPatchResult {
        return try {
            VibeflyAgentService.getInstance(project).withControl { control ->
                val result = control.setProviderApiKey(request)
                if (!result.ok) {
                    return@withControl ProvidersPatchResult(ok = false, error = result.error)
                }
                attachProvidersSnapshot(control, ProvidersPatchResult(ok = true))
            }
        } catch (e: Exception) {
            log.warn("setProviderApiKey failed", e)
            ProvidersPatchResult(ok = false, error = e.message ?: e.toString())
        }
    }

    override suspend fun mutateCustomProvider(
        request: CustomProviderMutationRequest,
        expectedRevision: String,
    ): ProvidersPatchResult {
        val application = VibeflyApplicationSettingsService.getInstance()
        val current = application.snapshot(refresh = true)
        revisionConflict(current, expectedRevision)?.let { return it }

        val patched = try {
            VibeflyAgentService.getInstance(project).withControl { control ->
                control.mutateCustomProvider(
                    request,
                    current.content(SettingsDocument.MODELS),
                    current.content(SettingsDocument.AUTH),
                )
            }
        } catch (error: Exception) {
            log.warn("mutateCustomProvider agent transform failed", error)
            return ProvidersPatchResult(ok = false, error = error.message ?: error.toString())
        }
        if (!patched.ok) {
            return ProvidersPatchResult(
                ok = false,
                error = patched.error ?: "Invalid custom provider mutation",
                revision = current.revision,
            )
        }
        if (patched.modelsChanged && patched.modelsJson == null) {
            return ProvidersPatchResult(
                ok = false,
                error = "Agent omitted modelsJson for a models change",
                revision = current.revision,
            )
        }
        if (patched.authChanged && patched.authJson == null) {
            return ProvidersPatchResult(
                ok = false,
                error = "Agent omitted authJson for an auth change",
                revision = current.revision,
            )
        }

        return persistProviderDocuments(
            modelsJson = if (patched.modelsChanged) patched.modelsJson else null,
            authJson = if (patched.authChanged) patched.authJson else null,
            expectedRevision = expectedRevision,
        )
    }

    override fun dispose() {
        settingsNotificationScope.cancel()
    }

    private fun forwardSettingsChanged(event: VibeflySettingsChanged) {
        val applies = event.scope == SETTINGS_SCOPE_APPLICATION ||
                (event.scope == SETTINGS_SCOPE_PROJECT && event.projectRoot == boundProjectRoot)
        if (!applies) return
        val host2Ui = host2UiProvider() ?: return
        settingsNotificationScope.launch {
            try {
                host2Ui.settingsChanged(event.scope, event.projectRoot, event.revision)
            } catch (error: Exception) {
                log.debug("Host2Ui.settingsChanged failed", error)
            }
        }
    }

    private suspend fun ProviderLoginResult.withHostSnapshot(control: Host2Agent): ProviderLoginResult {
        if (!ok) return this
        val settings = VibeflyApplicationSettingsService.getInstance().snapshot(refresh = true)
        return copy(
            snapshot = control.getProvidersSnapshot(
                settings.content(SettingsDocument.MODELS),
                settings.content(SettingsDocument.AUTH),
            ),
            revision = settings.revision,
            conflict = false,
        )
    }

    private suspend fun ProviderLogoutResult.withHostSnapshot(control: Host2Agent): ProviderLogoutResult {
        if (!ok) return this
        val settings = VibeflyApplicationSettingsService.getInstance().snapshot(refresh = true)
        return copy(
            snapshot = control.getProvidersSnapshot(
                settings.content(SettingsDocument.MODELS),
                settings.content(SettingsDocument.AUTH),
            ),
            revision = settings.revision,
            conflict = false,
        )
    }

    private fun revisionConflict(
        current: SettingsScopeSnapshot,
        expectedRevision: String,
    ): ProvidersPatchResult? {
        if (current.revision == expectedRevision) return null
        return ProvidersPatchResult(
            ok = false,
            error = "Settings revision conflict",
            revision = current.revision,
            conflict = true,
        )
    }

    private suspend fun persistProviderDocuments(
        modelsJson: String?,
        authJson: String?,
        expectedRevision: String,
    ): ProvidersPatchResult {
        val result = VibeflyApplicationSettingsService.getInstance().saveProviderDocuments(
            modelsJson = modelsJson,
            authJson = authJson,
            expectedRevision = expectedRevision,
        )
        if (!result.ok || result.conflict) {
            return ProvidersPatchResult(
                ok = result.ok,
                error = result.error,
                revision = result.revision,
                conflict = result.conflict,
            )
        }
        return try {
            VibeflyAgentService.getInstance(project).withControl { control ->
                attachProvidersSnapshot(
                    control,
                    ProvidersPatchResult(ok = true, revision = result.revision),
                )
            }
        } catch (error: Exception) {
            log.warn("attachProvidersSnapshot failed after provider document save", error)
            ProvidersPatchResult(
                ok = true,
                error = error.message ?: error.toString(),
                revision = result.revision,
            )
        }
    }

    private suspend fun attachProvidersSnapshot(
        control: Host2Agent,
        result: ProvidersPatchResult,
    ): ProvidersPatchResult {
        if (!result.ok) return result
        val settings = VibeflyApplicationSettingsService.getInstance().snapshot(refresh = true)
        return result.copy(
            snapshot = control.getProvidersSnapshot(
                settings.content(SettingsDocument.MODELS),
                settings.content(SettingsDocument.AUTH),
            ),
            revision = settings.revision,
            conflict = false,
        )
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
                    log.warn("BrowserUtil.browse fallback failed", e)
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
