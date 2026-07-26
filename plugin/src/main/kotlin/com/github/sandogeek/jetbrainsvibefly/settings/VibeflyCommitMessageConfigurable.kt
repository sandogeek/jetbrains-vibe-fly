package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersSnapshot
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.options.ConfigurationException
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.dsl.builder.Align
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.panel
import java.util.concurrent.atomic.AtomicInteger
import javax.swing.DefaultComboBoxModel
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.SwingUtilities

/**
 * Settings > Vibe Fly > Commit Message
 *
 * Language, commit-specific model, and optional custom system prompt.
 * Model list reuses [ProvidersSettingsCache] (connected providers only).
 */
class VibeflyCommitMessageConfigurable : SearchableConfigurable {

    private var root: DialogPanel? = null
    private lateinit var languageCombo: ComboBox<LanguageItem>
    private lateinit var modelField: ModelPickerField
    private lateinit var customPromptCheck: JBCheckBox
    private lateinit var customPromptArea: JBTextArea
    private lateinit var hintLabel: JLabel

    private var connectedModelSpecs: List<String> = emptyList()
    private val loadGeneration = AtomicInteger(0)

    override fun getId(): String = "vibefly.commitMessage"

    override fun getDisplayName(): String = VibeflyBundle.message("settings.commitMessage")

    override fun createComponent(): JComponent {
        root?.let { return it }

        root = panel {
            row(VibeflyBundle.message("settings.commitMessage.language")) {
                comboBox(emptyList<LanguageItem>())
                    .align(AlignX.FILL)
                    .resizableColumn()
                    .applyToComponent { languageCombo = this }
            }
            row(VibeflyBundle.message("settings.commitMessage.model")) {
                cell(ModelPickerField(allowFollowDefault = true).also { modelField = it })
                    .align(AlignX.FILL)
                    .resizableColumn()
            }
            row {
                checkBox(VibeflyBundle.message("settings.commitMessage.useCustomPrompt"))
                    .applyToComponent {
                        customPromptCheck = this
                        addActionListener { updateCustomPromptEnabled() }
                    }
            }
            row {
                comment(VibeflyBundle.message("settings.commitMessage.customPrompt.hint"))
            }
            row {
                val area = JBTextArea(8, 40).apply {
                    lineWrap = true
                    wrapStyleWord = true
                }
                customPromptArea = area
                cell(JBScrollPane(area))
                    .align(Align.FILL)
                    .resizableColumn()
            }.resizableRow()
            row {
                label(" ")
                    .applyToComponent {
                        hintLabel = this
                        foreground = JBColor.GRAY
                        isVisible = false
                    }
                    .align(AlignX.FILL)
            }
        }
        rebuildLanguageCombo()
        rebuildModelField(preferredSpec = "")
        updateCustomPromptEnabled()
        return root!!
    }

    override fun isModified(): Boolean {
        if (root == null) return false
        val settings = VibeflyCommitMessageSettingsState.getInstance()
        if (selectedLanguageMode() != VibeflyCommitMessageSettingsState.normalizeLanguageMode(settings.languageMode)) {
            return true
        }
        if (selectedModelSpec() != settings.commitModelSpec.trim()) return true
        if (customPromptCheck.isSelected != settings.useCustomPrompt) return true
        if (customPromptArea.text != settings.customPrompt) return true
        return false
    }

    @Throws(ConfigurationException::class)
    override fun apply() {
        if (customPromptCheck.isSelected && customPromptArea.text.trim().isEmpty()) {
            throw ConfigurationException(
                VibeflyBundle.message("settings.commitMessage.customPrompt.empty"),
            )
        }
        val settings = VibeflyCommitMessageSettingsState.getInstance()
        settings.languageMode = selectedLanguageMode()
        val modelSpec = selectedModelSpec()
        settings.commitModelSpec = modelSpec
        if (modelSpec.isNotEmpty()) {
            VibeflyModelPreferencesState.getInstance().recordUsed(modelSpec)
        }
        settings.useCustomPrompt = customPromptCheck.isSelected
        settings.customPrompt = customPromptArea.text
        clearHint()
    }

    override fun reset() {
        val settings = VibeflyCommitMessageSettingsState.getInstance()
        if (root == null) createComponent()

        selectLanguage(settings.languageMode)
        customPromptCheck.isSelected = settings.useCustomPrompt
        customPromptArea.text = settings.customPrompt
        updateCustomPromptEnabled()

        val painted = paintModelsFromCache(settings.commitModelSpec)
        if (!painted) {
            rebuildModelField(preferredSpec = settings.commitModelSpec)
        }
        scheduleModelRefresh(settings.commitModelSpec)
    }

    override fun disposeUIResources() {
        loadGeneration.incrementAndGet()
        root = null
    }

    private fun paintModelsFromCache(preferredSpec: String): Boolean {
        val agentDir = VibeflyProviderSettingsState.getInstance().resolvedAgentDir()
        val snapshot = ProvidersSettingsCache.getSnapshot(agentDir) ?: return false
        applyConnectedModels(snapshot, preferredSpec)
        return true
    }

    private fun scheduleModelRefresh(preferredSpec: String) {
        val agentDir = VibeflyProviderSettingsState.getInstance().resolvedAgentDir()
        val gen = loadGeneration.incrementAndGet()
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                BundledModelCatalog.ensureLoaded()
                val result = ProvidersSettingsLoader.fetch(agentDir)
                runOnEdtIfCurrent(gen) {
                    applyConnectedModels(result.snapshot, preferredSpec)
                }
            } catch (_: Exception) {
                // Keep last painted model list; generation still works with Providers default.
            }
        }
    }

    private fun applyConnectedModels(
        snapshot: ProvidersSnapshot,
        preferredSpec: String,
    ) {
        connectedModelSpecs = ProviderUiHelpers.connectedModelSpecs(snapshot.providers)
        if (::modelField.isInitialized) {
            modelField.setEntries(ModelPickerFilter.buildEntries(snapshot.providers))
        }
        rebuildModelField(preferredSpec = preferredSpec)
    }

    private fun rebuildLanguageCombo() {
        val items = listOf(
            LanguageItem(
                VibeflyCommitMessageSettingsState.LANGUAGE_FOLLOW_IDE,
                VibeflyBundle.message("settings.commitMessage.language.followIde"),
            ),
            LanguageItem(
                VibeflyCommitMessageSettingsState.LANGUAGE_EN,
                VibeflyBundle.message("settings.commitMessage.language.en"),
            ),
            LanguageItem(
                VibeflyCommitMessageSettingsState.LANGUAGE_ZH,
                VibeflyBundle.message("settings.commitMessage.language.zh"),
            ),
        )
        languageCombo.model = DefaultComboBoxModel(items.toTypedArray())
    }

    private fun rebuildModelField(preferredSpec: String) {
        if (!::modelField.isInitialized) return
        val wanted = preferredSpec.trim()
        if (wanted.isNotEmpty() && wanted in connectedModelSpecs) {
            modelField.setSelectedSpec(wanted)
            clearHint()
        } else {
            modelField.setSelectedSpec("")
            if (wanted.isNotEmpty() && connectedModelSpecs.isNotEmpty()) {
                showHint(VibeflyBundle.message("settings.commitMessage.model.invalidFallback"))
            } else {
                clearHint()
            }
        }
    }

    private fun selectLanguage(mode: String) {
        val normalized = VibeflyCommitMessageSettingsState.normalizeLanguageMode(mode)
        val model = languageCombo.model
        for (i in 0 until model.size) {
            val item = model.getElementAt(i) ?: continue
            if (item.mode == normalized) {
                languageCombo.selectedItem = item
                return
            }
        }
        if (model.size > 0) {
            languageCombo.selectedIndex = 0
        }
    }

    private fun selectedLanguageMode(): String {
        val item = languageCombo.selectedItem as? LanguageItem
        return item?.mode ?: VibeflyCommitMessageSettingsState.LANGUAGE_FOLLOW_IDE
    }

    private fun selectedModelSpec(): String {
        if (!::modelField.isInitialized) return ""
        return modelField.getSelectedSpec().trim()
    }

    private fun updateCustomPromptEnabled() {
        if (::customPromptArea.isInitialized) {
            customPromptArea.isEnabled = customPromptCheck.isSelected
        }
    }

    private fun showHint(message: String) {
        if (::hintLabel.isInitialized) {
            hintLabel.text = message
            hintLabel.isVisible = true
        }
    }

    private fun clearHint() {
        if (::hintLabel.isInitialized) {
            hintLabel.text = " "
            hintLabel.isVisible = false
        }
    }

    private fun runOnEdtIfCurrent(generation: Int, block: () -> Unit) {
        val app = ApplicationManager.getApplication()
        val task = Runnable {
            if (loadGeneration.get() != generation || root == null) return@Runnable
            block()
        }
        if (app.isDispatchThread) {
            task.run()
        } else {
            SwingUtilities.invokeLater(task)
        }
    }

    private data class LanguageItem(val mode: String, val label: String) {
        override fun toString(): String = label
    }
}
