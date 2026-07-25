package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.vibefly.jcef.rpc.ProviderSnapshot
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.components.JBPasswordField
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.panel
import java.awt.Component
import javax.swing.JComponent

/**
 * Catalog provider Connect / Edit dialog: API key + credential status only.
 */
class ProviderConnectDialog(
    parent: Component,
    private val snapshot: ProviderSnapshot,
    private val editMode: Boolean,
) : DialogWrapper(parent, true) {

    private lateinit var apiKeyField: JBPasswordField

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

    override fun doOKAction() {
        val key = apiKey.trim()
        if (!editMode && key.isEmpty()) {
            setErrorText(VibeflyBundle.message("dialog.apiKey.required"))
            return
        }
        setErrorText(null)
        super.doOKAction()
    }

    /** Non-blank key to set; blank means keep existing (edit) or invalid (connect). */
    val apiKey: String
        get() = String(apiKeyField.password)
}
