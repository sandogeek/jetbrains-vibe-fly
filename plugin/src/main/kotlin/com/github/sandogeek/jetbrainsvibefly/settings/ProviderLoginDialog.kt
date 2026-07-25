package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.vibefly.jcef.rpc.LoginInputRequest
import com.github.sandogeek.vibefly.jcef.rpc.LoginInputResponse
import com.github.sandogeek.vibefly.jcef.rpc.LoginOpenUrlRequest
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.components.JBTextField
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.panel
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CompletableDeferred
import java.awt.Component
import java.awt.Dimension
import java.util.concurrent.atomic.AtomicReference
import javax.swing.Action
import javax.swing.JComponent
import javax.swing.SwingUtilities

/**
 * Interactive Oh My Pi login dialog: browser open, progress, paste code/key.
 * Stays open while [loginProvider] RPC runs on a background thread.
 */
class ProviderLoginDialog(
    parent: Component,
    private val providerName: String,
    private val onCancelLogin: (() -> Unit)? = null,
) : DialogWrapper(parent, true), ProviderLoginUi {

    private val statusLabel = JBLabel(" ").apply {
        border = JBUI.Borders.empty(0, 0, 4, 0)
    }
    private val urlArea = JBTextArea(3, 48).apply {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
        border = JBUI.Borders.empty(4)
    }
    private val instructionsLabel = JBLabel(" ").apply {
        border = JBUI.Borders.empty(4, 0)
    }
    private val inputLabel = JBLabel(VibeflyBundle.message("dialog.login.input"))
    private val inputField = JBTextField().apply {
        columns = 40
    }
    private val submitInputButton = javax.swing.JButton(
        VibeflyBundle.message("dialog.login.submit"),
    )

    private val pendingInput = AtomicReference<CompletableDeferred<LoginInputResponse>?>(null)
    private var currentUrl: String = ""
    private var finished = false

    init {
        title = VibeflyBundle.message("dialog.login.title", providerName)
        isModal = true
        setOKButtonText(VibeflyBundle.message("dialog.login.working"))
        okAction.isEnabled = false
        init()
        submitInputButton.addActionListener { completeInput(cancelled = false) }
        inputField.addActionListener { completeInput(cancelled = false) }
        setInputEnabled(false)
        statusLabel.text = VibeflyBundle.message("dialog.login.starting", providerName)
    }

    override fun createCenterPanel(): JComponent {
        return panel {
            row {
                cell(statusLabel).align(AlignX.FILL)
            }
            row {
                cell(
                    JBScrollPane(urlArea).apply {
                        preferredSize = Dimension(JBUI.scale(480), JBUI.scale(72))
                    },
                ).align(AlignX.FILL)
            }
            row {
                button(VibeflyBundle.message("dialog.login.openBrowser")) {
                    openBrowser()
                }
            }
            row {
                cell(instructionsLabel).align(AlignX.FILL)
            }
            row {
                cell(inputLabel)
            }
            row {
                cell(inputField).align(AlignX.FILL).resizableColumn()
                cell(submitInputButton)
            }
        }
    }

    override fun createActions(): Array<Action> = arrayOf(cancelAction)

    override fun doCancelAction() {
        val pending = pendingInput.getAndSet(null)
        pending?.complete(LoginInputResponse(text = "", cancelled = true))
        if (!finished) {
            try {
                onCancelLogin?.invoke()
            } catch (_: Exception) {
            }
        }
        super.doCancelAction()
    }

    override fun onOpenUrl(request: LoginOpenUrlRequest) {
        currentUrl = request.launchUrl?.takeIf { it.isNotBlank() } ?: request.url
        urlArea.text = request.url
        instructionsLabel.text = request.instructions?.takeIf { it.isNotBlank() }
            ?: VibeflyBundle.message("dialog.login.authHint")
        statusLabel.text = VibeflyBundle.message("dialog.login.waitingAuth")
        openBrowser()
    }

    override fun onProgress(message: String) {
        if (message.isNotBlank()) {
            statusLabel.text = message
        }
    }

    override suspend fun requestInput(request: LoginInputRequest): LoginInputResponse {
        val deferred = CompletableDeferred<LoginInputResponse>()
        pendingInput.getAndSet(deferred)?.complete(
            LoginInputResponse(text = "", cancelled = true),
        )
        val show = Runnable {
            inputLabel.text = request.message.ifBlank {
                VibeflyBundle.message("dialog.login.input")
            }
            inputField.emptyText.text = request.placeholder.orEmpty()
            inputField.text = ""
            setInputEnabled(true)
            statusLabel.text = request.message
            inputField.requestFocusInWindow()
        }
        if (SwingUtilities.isEventDispatchThread()) {
            show.run()
        } else {
            SwingUtilities.invokeAndWait(show)
        }
        return deferred.await()
    }

    fun markSuccess(detail: String?) {
        finished = true
        statusLabel.text = detail?.takeIf { it.isNotBlank() }
            ?: VibeflyBundle.message("dialog.login.success")
        setInputEnabled(false)
        close(OK_EXIT_CODE)
    }

    fun markFailure(error: String) {
        finished = true
        statusLabel.text = error
        setInputEnabled(false)
        // Keep dialog open so the user can read the error; Cancel closes.
        setErrorText(error)
    }

    private fun setInputEnabled(enabled: Boolean) {
        inputField.isEnabled = enabled
        submitInputButton.isEnabled = enabled
    }

    private fun completeInput(cancelled: Boolean) {
        val deferred = pendingInput.getAndSet(null) ?: return
        val text = inputField.text.orEmpty()
        setInputEnabled(false)
        deferred.complete(
            LoginInputResponse(
                text = if (cancelled) "" else text,
                cancelled = cancelled,
            ),
        )
    }

    private fun openBrowser() {
        val target = currentUrl.ifBlank { urlArea.text.trim() }
        if (target.isBlank()) return
        try {
            BrowserUtil.browse(target)
        } catch (_: Exception) {
            // URL remains visible for manual open.
        }
    }

    companion object {
        /**
         * Run [login] on a pooled thread while this dialog handles reverse RPC.
         * Returns true when login succeeded.
         */
        fun runLogin(
            parent: Component,
            providerName: String,
            login: () -> ProviderLoginOutcome,
            cancelLogin: (() -> Unit)? = null,
        ): ProviderLoginOutcome {
            val dialog = ProviderLoginDialog(parent, providerName, onCancelLogin = cancelLogin)
            val outcome = AtomicReference(
                ProviderLoginOutcome(ok = false, error = "Login did not start"),
            )
            ApplicationManager.getApplication().executeOnPooledThread {
                val result = try {
                    Agent2HostBridge.withUi(dialog) {
                        login()
                    }
                } catch (e: Exception) {
                    ProviderLoginOutcome(
                        ok = false,
                        error = e.message ?: e.toString(),
                    )
                }
                outcome.set(result)
                SwingUtilities.invokeLater {
                    if (!dialog.isShowing) return@invokeLater
                    if (result.ok) {
                        dialog.markSuccess(result.message)
                    } else if (result.cancelled) {
                        dialog.close(CANCEL_EXIT_CODE)
                    } else {
                        dialog.markFailure(
                            result.error
                                ?: VibeflyBundle.message("dialog.login.failed"),
                        )
                    }
                }
            }
            dialog.show()
            // If user cancelled while success was pending, prefer cancel.
            if (dialog.exitCode != DialogWrapper.OK_EXIT_CODE && !outcome.get().ok) {
                return ProviderLoginOutcome(
                    ok = false,
                    error = VibeflyBundle.message("dialog.login.cancelled"),
                    cancelled = true,
                )
            }
            return outcome.get()
        }
    }
}

data class ProviderLoginOutcome(
    val ok: Boolean,
    val error: String? = null,
    val message: String? = null,
    val cancelled: Boolean = false,
)
