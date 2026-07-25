package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.vibefly.jcef.rpc.ProviderModelPatch
import com.github.sandogeek.vibefly.jcef.rpc.ProviderModelSnapshot
import com.github.sandogeek.vibefly.jcef.rpc.ProviderPatch
import com.github.sandogeek.vibefly.jcef.rpc.ProviderSnapshot
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.components.JBPasswordField
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.components.JBTextField
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.columns
import com.intellij.ui.dsl.builder.panel
import com.intellij.ui.dsl.builder.rows
import java.awt.Component
import javax.swing.JComponent

/**
 * Add / Edit custom provider dialog (full fields).
 */
class CustomProviderDialog(
    parent: Component,
    private val existing: ProviderSnapshot?,
    private val catalogIds: Set<String>,
    private val existingCustomIds: Set<String>,
) : DialogWrapper(parent, true) {

    private lateinit var idField: JBTextField
    private lateinit var baseUrlField: JBTextField
    private lateinit var apiCombo: ComboBox<String>
    private lateinit var authCombo: ComboBox<String>
    private lateinit var modelsArea: JBTextArea
    private lateinit var apiKeyField: JBPasswordField

    private val isEdit = existing != null

    private val apiOptions = listOf(
        "",
        "openai-responses",
        "openai-completions",
        "anthropic-messages",
        "google-generative-ai",
        "azure-openai-responses",
        "openai-codex-responses",
    )

    init {
        title = if (isEdit) {
            VibeflyBundle.message(
                "dialog.custom.edit.title",
                ProviderUiHelpers.displayName(existing!!.id),
            )
        } else {
            VibeflyBundle.message("dialog.custom.add.title")
        }
        init()
    }

    override fun createCenterPanel(): JComponent {
        return panel {
            row(VibeflyBundle.message("dialog.providerId")) {
                textField()
                    .align(AlignX.FILL)
                    .applyToComponent {
                        idField = this
                        if (existing != null) {
                            text = existing.id
                            isEnabled = false
                        }
                    }
            }
            row(VibeflyBundle.message("dialog.baseUrl")) {
                textField()
                    .align(AlignX.FILL)
                    .applyToComponent {
                        baseUrlField = this
                        text = existing?.baseUrl.orEmpty()
                    }
            }
            row(VibeflyBundle.message("dialog.apiType")) {
                comboBox(apiOptions)
                    .align(AlignX.FILL)
                    .applyToComponent {
                        apiCombo = this
                        selectedItem = existing?.api.orEmpty()
                    }
            }
            row(VibeflyBundle.message("dialog.models")) {
                textArea()
                    .rows(6)
                    .columns(40)
                    .align(AlignX.FILL)
                    .comment(VibeflyBundle.message("dialog.models.hint"))
                    .applyToComponent {
                        modelsArea = this
                        lineWrap = true
                        wrapStyleWord = true
                        text = existing?.models?.let { formatModels(it) }.orEmpty()
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
                comment(
                    existing?.let { ProviderUiHelpers.credentialStatusText(it) }
                        ?: VibeflyBundle.message("provider.credential.apiKey.unset"),
                )
            }
        }
    }

    override fun doOKAction() {
        val id = providerId
        if (id.isEmpty()) {
            setErrorText(VibeflyBundle.message("dialog.providerId.required"))
            return
        }
        if (!isEdit) {
            if (id in catalogIds) {
                setErrorText(VibeflyBundle.message("dialog.providerId.catalogClash"))
                return
            }
            if (id in existingCustomIds) {
                setErrorText(VibeflyBundle.message("dialog.providerId.duplicate"))
                return
            }
            if (!ID_PATTERN.matches(id)) {
                setErrorText(VibeflyBundle.message("dialog.providerId.invalid"))
                return
            }
        }
        setErrorText(null)
        super.doOKAction()
    }

    val providerId: String
        get() = idField.text.trim()

    val apiKey: String
        get() = String(apiKeyField.password)

    fun toProviderPatch(): ProviderPatch {
        val models = parseModelsText(modelsArea.text)
            .map { ProviderModelPatch(id = it.id, name = it.name, api = it.api) }
        val baseUrl = baseUrlField.text.trim().ifEmpty { null }
        val api = (apiCombo.selectedItem as? String)?.trim()?.ifEmpty { null }
        var auth = (authCombo.selectedItem as? String)?.trim()?.ifEmpty { null }
        if (!isEdit && auth == null) {
            auth = "none"
        }
        return ProviderPatch(
            id = providerId,
            baseUrl = baseUrl,
            api = api,
            auth = auth,
            models = models,
            clearBaseUrl = baseUrl == null,
            clearApi = api == null,
        )
    }

    companion object {
        private val ID_PATTERN = Regex("^[a-zA-Z0-9][a-zA-Z0-9._-]*$")

        fun formatModels(models: List<ProviderModelSnapshot>): String {
            return models.joinToString("\n") { m ->
                val name = m.name?.takeIf { it.isNotBlank() && it != m.id }
                val api = m.api?.takeIf { it.isNotBlank() }
                when {
                    name != null && api != null -> "${m.id} | $name | $api"
                    name != null -> "${m.id} | $name"
                    api != null -> "${m.id} | | $api"
                    else -> m.id
                }
            }
        }

        fun parseModelsText(text: String): List<ProviderModelSnapshot> {
            return text.lineSequence()
                .map { it.trim() }
                .filter { it.isNotEmpty() && !it.startsWith("#") }
                .map { line ->
                    val parts = line.split("|").map { it.trim() }
                    val id = parts.getOrNull(0).orEmpty()
                    val name = parts.getOrNull(1)?.takeIf { it.isNotEmpty() }
                    val api = parts.getOrNull(2)?.takeIf { it.isNotEmpty() }
                    ProviderModelSnapshot(
                        id = id,
                        name = name,
                        api = api,
                        isCustom = true,
                    )
                }
                .filter { it.id.isNotBlank() }
                .toList()
        }
    }
}
