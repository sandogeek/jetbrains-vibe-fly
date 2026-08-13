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
            val snapshot = ProviderSettingsJson.snapshot(settings)
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
    ): ProvidersPatchResult = VibeflyApplicationSettingsService.getInstance()
        .applyProvidersPatch(request, expectedRevision)

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
            }.withHostSnapshot()
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
            }.withHostSnapshot()
        } catch (e: Exception) {
            log.warn("logoutProvider failed", e)
            ProviderLogoutResult(ok = false, error = e.message ?: e.toString())
        }
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

    private fun ProviderLoginResult.withHostSnapshot(): ProviderLoginResult {
        if (!ok) return this
        val application = VibeflyApplicationSettingsService.getInstance()
        val settings = application.snapshot(refresh = true)
        return copy(
            snapshot = ProviderSettingsJson.snapshot(settings),
            revision = settings.revision,
            conflict = false,
        )
    }

    private fun ProviderLogoutResult.withHostSnapshot(): ProviderLogoutResult {
        if (!ok) return this
        val application = VibeflyApplicationSettingsService.getInstance()
        val settings = application.snapshot(refresh = true)
        return copy(
            snapshot = ProviderSettingsJson.snapshot(settings),
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
