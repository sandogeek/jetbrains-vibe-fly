package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.vibefly.jcef.rpc.ProviderSnapshot
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.components.JBPasswordField
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.panel
import java.awt.Component
import javax.swing.Action
import javax.swing.JComponent

/**
 * Catalog provider Connect / Edit dialog: optional Oh My Pi login + API key.
 */
class ProviderConnectDialog(
    parent: Component,
    private val snapshot: ProviderSnapshot,
    private val editMode: Boolean,
) : DialogWrapper(parent, true) {

    private lateinit var apiKeyField: JBPasswordField
    private var choseLogin = false

    init {
        val name = ProviderUiHelpers.displayName(snapshot.id)
        title = if (editMode) {
            VibeflyBundle.message("dialog.edit.title", name)
        } else {
            VibeflyBundle.message("dialog.connect.title", name)
        }
        init()
    }

    override fun createCenterPanel(): JComponent {
        return panel {
            if (snapshot.supportsLogin) {
                row {
                    comment(VibeflyBundle.message("dialog.connect.loginHint"))
                }
            }
            row(VibeflyBundle.message("dialog.apiKey")) {
                passwordField()
                    .align(AlignX.FILL)
                    .comment(VibeflyBundle.message("dialog.apiKey.keepHint"))
                    .applyToComponent {
                        apiKeyField = this
                        columns = 36
                    }
            }
            row {
                comment(ProviderUiHelpers.credentialStatusText(snapshot))
            }
        }
    }

    override fun createActions(): Array<Action> {
        val actions = mutableListOf<Action>()
        if (snapshot.supportsLogin && !editMode) {
            actions.add(
                object : DialogWrapperAction(VibeflyBundle.message("dialog.connect.login")) {
                    override fun doAction(e: java.awt.event.ActionEvent?) {
                        choseLogin = true
                        close(OK_EXIT_CODE)
                    }
                },
            )
        }
        actions.add(okAction)
        actions.add(cancelAction)
        return actions.toTypedArray()
    }

    override fun doOKAction() {
        choseLogin = false
        val key = apiKey.trim()
        if (!editMode && key.isEmpty() && !snapshot.supportsLogin) {
            setErrorText(VibeflyBundle.message("dialog.apiKey.required"))
            return
        }
        if (!editMode && key.isEmpty() && snapshot.supportsLogin) {
            // Prefer explicit Login button; empty OK is invalid.
            setErrorText(VibeflyBundle.message("dialog.apiKey.orLogin"))
            return
        }
        setErrorText(null)
        super.doOKAction()
    }

    /** Non-blank key to set; blank means keep existing (edit) or invalid (connect). */
    val apiKey: String
        get() = String(apiKeyField.password)

    /** User chose Oh My Pi interactive login (browser OAuth or paste key flow). */
    val useLogin: Boolean
        get() = choseLogin
}
