package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.jetbrainsvibefly.agent.VibeflyAgentService
import com.github.sandogeek.vibefly.jcef.rpc.CatalogProvider
import com.github.sandogeek.vibefly.jcef.rpc.CredentialAction
import com.github.sandogeek.vibefly.jcef.rpc.ProviderPatch
import com.github.sandogeek.vibefly.jcef.rpc.ProviderSnapshot
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersPatchRequest
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersPatchResult
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersSnapshot
import com.intellij.icons.AllIcons
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogPanel
import com.intellij.openapi.ui.Messages
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.JBColor
import com.intellij.ui.SearchTextField
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.ui.dsl.builder.Align
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.BottomGap
import com.intellij.ui.dsl.builder.Cell
import com.intellij.ui.dsl.builder.Panel
import com.intellij.ui.dsl.builder.RightGap
import com.intellij.ui.dsl.builder.RowLayout
import com.intellij.ui.dsl.builder.TopGap
import com.intellij.ui.dsl.builder.panel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Font
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import javax.swing.DefaultComboBoxModel
import javax.swing.Icon
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.SwingUtilities
import javax.swing.event.DocumentEvent

/**
 * Settings > Vibe Fly > Providers
 *
 * Kilo-style Connected / Popular list with immediate Connect/Edit/Disconnect/Delete.
 * Built with Kotlin UI DSL. Agent directory + default model use Settings Apply.
 *
 * Open path is non-blocking: paint from in-memory cache immediately, refresh agent
 * data on a pooled thread (reuse a live project agent when available).
 */
class VibeflyProvidersConfigurable : SearchableConfigurable, Configurable.NoScroll {

    private var root: DialogPanel? = null
    private lateinit var agentDirField: JBTextField
    private lateinit var builtinSearchField: SearchTextField
    private lateinit var defaultModelCombo: ComboBox<String>
    private lateinit var errorLabel: JLabel
    /** Connected + add-custom + built-in header/search (outside scroll). */
    private val fixedListsHeader = JPanel(BorderLayout())
    /** Built-in provider rows only (inside scroll). */
    private val builtinListHolder = JPanel(BorderLayout())

    private var catalogProviders: List<CatalogProvider> = emptyList()
    private var snapshots: MutableMap<String, ProviderSnapshot> = linkedMapOf()
    private var loadError: String? = null
    private var loading: Boolean = false

    /** Bumped on each load request / dispose to drop stale background results. */
    private val loadGeneration = AtomicInteger(0)

    override fun getId(): String = "vibefly.providers"

    override fun getDisplayName(): String = VibeflyBundle.message("settings.providers")

    override fun createComponent(): JComponent {
        root?.let {
            activeInstance.set(this)
            return it
        }

        builtinSearchField = SearchTextField(false).apply {
            textEditor.emptyText.text =
                VibeflyBundle.message("settings.providers.buildin.search.placeholder")
            textEditor.border = JBUI.Borders.empty(2, 4)
            addDocumentListener(object : DocumentAdapter() {
                override fun textChanged(e: DocumentEvent) {
                    rebuildSections()
                }
            })
        }

        root = panel {
            row(VibeflyBundle.message("settings.providers.agentDir")) {
                textField()
                    .align(AlignX.FILL)
                    .resizableColumn()
                    .applyToComponent { agentDirField = this }
            }
            row(VibeflyBundle.message("settings.providers.defaultModel")) {
                comboBox(listOf(""))
                    .align(AlignX.FILL)
                    .resizableColumn()
                    .gap(RightGap.SMALL)
                    .applyToComponent { defaultModelCombo = this }
                button(VibeflyBundle.message("settings.providers.reload")) {
                    scheduleLoad(
                        agentDir = currentAgentDirRaw(),
                        preferredProvider = parseDefaultModelSelection().first,
                        preferredModel = parseDefaultModelSelection().second,
                        forceNetwork = true,
                    )
                }.withIcon(AllIcons.Actions.Refresh)
            }
            row {
                label(" ")
                    .applyToComponent {
                        errorLabel = this
                        foreground = JBColor.RED
                        isVisible = false
                    }
                    .align(AlignX.FILL)
            }
            // Fixed header (Connected / search) does not scroll with the built-in list.
            row {
                cell(fixedListsHeader)
                    .align(AlignX.FILL)
                    .resizableColumn()
            }
            row {
                scrollCell(builtinListHolder)
                    .align(Align.FILL)
                    .resizableColumn()
            }.resizableRow()
            row {
                comment(VibeflyBundle.message("settings.providers.footer"))
            }
        }
        rebuildSections()
        activeInstance.set(this)
        return root!!
    }

    override fun isModified(): Boolean {
        val settings = VibeflyProviderSettingsState.getInstance()
        if (agentDirField.text.trim() != settings.agentDir.trim()) return true
        val (dp, dm) = parseDefaultModelSelection()
        if (dp != settings.defaultProvider.trim()) return true
        if (dm != settings.defaultModel.trim()) return true
        return false
    }

    override fun apply() {
        val settings = VibeflyProviderSettingsState.getInstance()
        val (dp, dm) = parseDefaultModelSelection()
        settings.agentDir = agentDirField.text.trim()
        settings.defaultProvider = dp
        settings.defaultModel = dm

        // Single stop path (off-EDT inside stopAllOpenProjects).
        VibeflyAgentService.stopAllOpenProjects()
    }

    override fun reset() {
        val settings = VibeflyProviderSettingsState.getInstance()
        if (root == null) createComponent()
        agentDirField.text = settings.agentDir

        val dir = settings.resolvedAgentDir()
        val paintedFromCache = paintFromCacheIfAvailable(
            agentDir = dir,
            preferredProvider = settings.defaultProvider,
            preferredModel = settings.defaultModel,
        )
        if (!paintedFromCache) {
            loading = true
            clearError()
            showStatus(VibeflyBundle.message("settings.providers.loading"))
            rebuildSections()
            rebuildDefaultModelCombo()
        }

        scheduleLoad(
            agentDir = dir,
            preferredProvider = settings.defaultProvider,
            preferredModel = settings.defaultModel,
            forceNetwork = false,
        )
    }

    override fun disposeUIResources() {
        loadGeneration.incrementAndGet()
        activeInstance.compareAndSet(this, null)
        root = null
    }

    /**
     * Only invoked when a project agent becomes READY ([onAgentReady]).
     * Reloads providers via the live process (no cold one-shot).
     */
    private fun scheduleLoadOnAgentReady() {
        if (root == null) return
        val settings = VibeflyProviderSettingsState.getInstance()
        val dir = if (::agentDirField.isInitialized) {
            currentAgentDirRaw()
        } else {
            settings.agentDir
        }
        val (dp, dm) = if (::defaultModelCombo.isInitialized) {
            parseDefaultModelSelection()
        } else {
            settings.defaultProvider to settings.defaultModel
        }
        scheduleLoad(
            agentDir = dir,
            preferredProvider = dp.ifEmpty { settings.defaultProvider },
            preferredModel = dm.ifEmpty { settings.defaultModel },
            forceNetwork = false,
        )
    }

    private fun currentAgentDirRaw(): String =
        agentDirField.text.trim().ifEmpty {
            VibeflyProviderSettingsState.defaultAgentDir()
        }

    private fun currentAgentDirExpanded(): String =
        VibeflyProviderSettingsState.expandHome(currentAgentDirRaw())

    /**
     * Instant paint from session cache so Settings open is not blocked by Bun start.
     * @return true when both catalog and snapshot were available for [agentDir]
     */
    private fun paintFromCacheIfAvailable(
        agentDir: String,
        preferredProvider: String,
        preferredModel: String,
    ): Boolean {
        val expanded = VibeflyProviderSettingsState.expandHome(
            agentDir.ifEmpty { VibeflyProviderSettingsState.defaultAgentDir() },
        )
        val catalog = ProvidersSettingsCache.getCatalog() ?: return false
        val snapshot = ProvidersSettingsCache.getSnapshot(expanded) ?: return false
        catalogProviders = catalog.providers
        applySnapshot(snapshot)
        loading = false
        clearError()
        rebuildDefaultModelCombo()
        rebuildSections()
        selectDefaultModel(preferredProvider, preferredModel)
        return true
    }

    private fun scheduleLoad(
        agentDir: String,
        preferredProvider: String,
        preferredModel: String,
        forceNetwork: Boolean,
    ) {
        val expanded = VibeflyProviderSettingsState.expandHome(
            agentDir.ifEmpty { VibeflyProviderSettingsState.defaultAgentDir() },
        )
        val gen = loadGeneration.incrementAndGet()
        loading = true
        if (forceNetwork || snapshots.isEmpty()) {
            showStatus(VibeflyBundle.message("settings.providers.loading"))
        }

        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val result = ProvidersSettingsLoader.fetch(expanded)
                runOnEdtIfCurrent(gen) {
                    catalogProviders = result.catalog.providers
                    applySnapshot(result.snapshot)
                    loading = false
                    clearError()
                    rebuildDefaultModelCombo()
                    rebuildSections()
                    selectDefaultModel(preferredProvider, preferredModel)
                }
            } catch (e: Exception) {
                log.warn("Failed to load providers", e)
                runOnEdtIfCurrent(gen) {
                    loading = false
                    if (snapshots.isEmpty()) {
                        catalogProviders = emptyList()
                        snapshots.clear()
                        showError(
                            VibeflyBundle.message(
                                "settings.providers.loadFailed",
                                e.message ?: e.toString(),
                            ),
                        )
                        rebuildSections()
                        rebuildDefaultModelCombo()
                    } else {
                        // Keep last good UI; do not block Connect/Edit.
                        showStatus(
                            VibeflyBundle.message(
                                "settings.providers.refreshFailed",
                                e.message ?: e.toString(),
                            ),
                        )
                    }
                }
            }
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

    private fun applySnapshot(snapshot: ProvidersSnapshot) {
        snapshots = linkedMapOf()
        for (p in snapshot.providers) {
            snapshots[p.id] = p
        }
    }

    private fun rebuildSections() {
        val classified = ProviderUiHelpers.classifyProviders(snapshots.values.toList())
        val filteredBuiltIn = ProviderUiHelpers.filterBuiltInProviders(
            classified.popular,
            builtinSearchQuery(),
        )
        // Allow mutations when we already have data (e.g. cache paint + background refresh).
        val canMutate = loadError == null && (!loading || snapshots.isNotEmpty())
        val showSearch = classified.popular.isNotEmpty() || builtinSearchQuery().isNotEmpty()

        // Detach reusable search field before rebuilding its parent tree.
        builtinSearchField.parent?.remove(builtinSearchField)

        val header = panel {
            group(VibeflyBundle.message("settings.providers.connected")) {
                if (loading && classified.connected.isEmpty()) {
                    row {
                        comment(VibeflyBundle.message("settings.providers.loadingShort"))
                    }
                } else if (classified.connected.isEmpty()) {
                    row {
                        comment(VibeflyBundle.message("settings.providers.connected.empty"))
                    }
                } else {
                    for (snap in classified.connected) {
                        connectedRow(snap)
                    }
                }
            }

            row {
                button(VibeflyBundle.message("settings.providers.addCustom")) { onAddCustom() }
                    .withIcon(AllIcons.General.Add)
                    .enabled(canMutate)
            }.topGap(TopGap.SMALL).bottomGap(BottomGap.SMALL)

            // Built-in title + sticky search stay outside the scroll pane.
            row {
                label(VibeflyBundle.message("settings.providers.buildin")).bold()
            }.topGap(TopGap.MEDIUM)
            if (showSearch) {
                row {
                    cell(builtinSearchField)
                        .align(AlignX.FILL)
                        .resizableColumn()
                }.bottomGap(BottomGap.SMALL)
            }
        }

        val builtinBody = panel {
            if (loading && filteredBuiltIn.isEmpty() && classified.popular.isEmpty()) {
                row {
                    comment(VibeflyBundle.message("settings.providers.loadingShort"))
                }
            } else if (classified.popular.isEmpty() && builtinSearchQuery().isEmpty()) {
                row {
                    comment(VibeflyBundle.message("settings.providers.buildin.empty"))
                }
            } else if (filteredBuiltIn.isEmpty()) {
                row {
                    comment(VibeflyBundle.message("settings.providers.buildin.noResults"))
                }
            } else {
                for (snap in filteredBuiltIn) {
                    popularRow(snap, canMutate)
                }
            }
        }

        fixedListsHeader.removeAll()
        fixedListsHeader.add(header, BorderLayout.NORTH)
        fixedListsHeader.revalidate()
        fixedListsHeader.repaint()

        builtinListHolder.removeAll()
        // NORTH keeps preferred height (avoids huge blank stretch).
        builtinListHolder.add(builtinBody, BorderLayout.NORTH)
        builtinListHolder.revalidate()
        builtinListHolder.repaint()
    }

    private fun builtinSearchQuery(): String =
        if (::builtinSearchField.isInitialized) builtinSearchField.text.trim() else ""

    private fun Panel.connectedRow(snap: ProviderSnapshot) {
        val name = ProviderUiHelpers.displayName(snap.id)
        val badge = ProviderUiHelpers.badgeLabel(ProviderUiHelpers.primaryBadge(snap))
        row {
            panel {
                row {
                    label(name).bold().gap(RightGap.SMALL)
                    cell(
                        JBLabel(badge).apply {
                            font = font.deriveFont(Font.PLAIN, font.size2D * 0.85f)
                            foreground = JBColor.GRAY
                            border = JBUI.Borders.compound(
                                JBUI.Borders.customLine(JBColor.border(), 1),
                                JBUI.Borders.empty(1, 6),
                            )
                        },
                    )
                }.layout(RowLayout.INDEPENDENT)
            }.resizableColumn().align(AlignX.FILL)
            button(VibeflyBundle.message("settings.providers.edit")) {
                if (snap.isCatalog) onEditCatalog(snap) else onEditCustom(snap)
            }.withIcon(AllIcons.Actions.Edit)
            if (snap.isCatalog) {
                button(VibeflyBundle.message("settings.providers.disconnect")) { onDisconnect(snap) }
                    .withIcon(AllIcons.Actions.Cancel)
            } else {
                button(VibeflyBundle.message("settings.providers.delete")) { onDeleteCustom(snap) }
                    .withIcon(AllIcons.General.Remove)
            }
        }.layout(RowLayout.PARENT_GRID)
    }

    private fun Panel.popularRow(
        snap: ProviderSnapshot,
        canMutate: Boolean,
    ) {
        val name = ProviderUiHelpers.displayName(snap.id)
        val desc = ProviderUiHelpers.description(snap.id)
        row {
            panel {
                row {
                    label(name).bold()
                }
                row {
                    comment(desc)
                }.topGap(TopGap.NONE)
            }.resizableColumn().align(AlignX.FILL)
            button(VibeflyBundle.message("settings.providers.connect")) { onConnect(snap) }
                .withIcon(AllIcons.General.Web)
                .enabled(canMutate)
        }.layout(RowLayout.PARENT_GRID).bottomGap(BottomGap.SMALL)
    }

    private fun Cell<JButton>.withIcon(icon: Icon): Cell<JButton> =
        applyToComponent { this.icon = icon }

    private fun parentComponent(): JComponent =
        root ?: createComponent()

    private fun onConnect(snap: ProviderSnapshot) {
        val dialog = ProviderConnectDialog(parentComponent(), snap, editMode = false)
        if (!dialog.showAndGet()) return
        val key = dialog.apiKey.trim()
        if (key.isEmpty()) return
        applyImmediatePatch(
            credentials = listOf(
                CredentialAction(provider = snap.id, action = "set", apiKey = key),
            ),
        )
    }

    private fun onEditCatalog(snap: ProviderSnapshot) {
        val dialog = ProviderConnectDialog(parentComponent(), snap, editMode = true)
        if (!dialog.showAndGet()) return
        val key = dialog.apiKey.trim()
        if (key.isEmpty()) return
        applyImmediatePatch(
            credentials = listOf(
                CredentialAction(provider = snap.id, action = "set", apiKey = key),
            ),
        )
    }

    private fun onDisconnect(snap: ProviderSnapshot) {
        val confirm = Messages.showYesNoDialog(
            parentComponent(),
            VibeflyBundle.message(
                "settings.providers.disconnect.confirm",
                ProviderUiHelpers.displayName(snap.id),
            ),
            VibeflyBundle.message("settings.providers.disconnect.title"),
            Messages.getQuestionIcon(),
        )
        if (confirm != Messages.YES) return
        applyImmediatePatch(
            credentials = listOf(
                CredentialAction(provider = snap.id, action = "clear"),
            ),
        )
    }

    private fun onAddCustom() {
        val catalogIds = snapshots.values.filter { it.isCatalog }.map { it.id }.toSet() +
            catalogProviders.map { it.id }.toSet()
        val customIds = snapshots.values.filter { !it.isCatalog }.map { it.id }.toSet()
        val dialog = CustomProviderDialog(
            parent = parentComponent(),
            existing = null,
            catalogIds = catalogIds,
            existingCustomIds = customIds,
        )
        if (!dialog.showAndGet()) return
        val patch = dialog.toProviderPatch()
        val key = dialog.apiKey.trim()
        val credentials = if (key.isNotEmpty()) {
            listOf(CredentialAction(provider = patch.id, action = "set", apiKey = key))
        } else {
            emptyList()
        }
        applyImmediatePatch(providers = listOf(patch), credentials = credentials)
    }

    private fun onEditCustom(snap: ProviderSnapshot) {
        val catalogIds = snapshots.values.filter { it.isCatalog }.map { it.id }.toSet() +
            catalogProviders.map { it.id }.toSet()
        val customIds = snapshots.values
            .filter { !it.isCatalog && it.id != snap.id }
            .map { it.id }
            .toSet()
        val dialog = CustomProviderDialog(
            parent = parentComponent(),
            existing = snap,
            catalogIds = catalogIds,
            existingCustomIds = customIds,
        )
        if (!dialog.showAndGet()) return
        val patch = dialog.toProviderPatch()
        val key = dialog.apiKey.trim()
        val credentials = if (key.isNotEmpty()) {
            listOf(CredentialAction(provider = patch.id, action = "set", apiKey = key))
        } else {
            emptyList()
        }
        applyImmediatePatch(providers = listOf(patch), credentials = credentials)
    }

    private fun onDeleteCustom(snap: ProviderSnapshot) {
        val confirm = Messages.showYesNoDialog(
            parentComponent(),
            VibeflyBundle.message("settings.providers.delete.confirm", snap.id),
            VibeflyBundle.message("settings.providers.delete.title"),
            Messages.getWarningIcon(),
        )
        if (confirm != Messages.YES) return
        applyImmediatePatch(
            providers = listOf(ProviderPatch(id = snap.id, remove = true)),
            credentials = listOf(CredentialAction(provider = snap.id, action = "clear")),
        )
    }

    private fun applyImmediatePatch(
        providers: List<ProviderPatch> = emptyList(),
        credentials: List<CredentialAction> = emptyList(),
    ) {
        val expanded = currentAgentDirExpanded()
        var result: ProvidersPatchResult? = null
        var error: Exception? = null
        val completed = ProgressManager.getInstance().runProcessWithProgressSynchronously(
            {
                try {
                    result = VibeflyAgentService.withControlForSettings(agentDir = expanded) { control ->
                        control.applyProvidersPatch(
                            ProvidersPatchRequest(
                                agentDir = expanded,
                                providers = providers,
                                credentials = credentials,
                            ),
                        )
                    }
                } catch (e: Exception) {
                    error = e
                }
            },
            VibeflyBundle.message("settings.providers.updating"),
            true,
            null,
        )
        if (!completed) return

        val failed = error
        if (failed != null) {
            log.warn("applyProvidersPatch failed", failed)
            Messages.showErrorDialog(
                parentComponent(),
                failed.message ?: failed.toString(),
                VibeflyBundle.message("settings.providers.updateFailed.title"),
            )
            return
        }
        val patchResult = result
        if (patchResult == null) {
            Messages.showErrorDialog(
                parentComponent(),
                VibeflyBundle.message("settings.providers.updateFailed.message"),
                VibeflyBundle.message("settings.providers.updateFailed.title"),
            )
            return
        }
        if (!patchResult.ok) {
            Messages.showErrorDialog(
                parentComponent(),
                patchResult.error
                    ?: VibeflyBundle.message("settings.providers.updateFailed.message"),
                VibeflyBundle.message("settings.providers.updateFailed.title"),
            )
            return
        }
        clearError()
        if (patchResult.snapshot != null) {
            applySnapshot(patchResult.snapshot!!)
            val catalog = ProvidersSettingsCache.getCatalog()
            if (catalog != null) {
                ProvidersSettingsCache.put(expanded, catalog, patchResult.snapshot!!)
            } else {
                ProvidersSettingsCache.invalidateSnapshot(expanded)
            }
            rebuildDefaultModelCombo()
            rebuildSections()
            pruneOrphanDefaultModel()
        } else {
            scheduleLoad(
                agentDir = expanded,
                preferredProvider = parseDefaultModelSelection().first,
                preferredModel = parseDefaultModelSelection().second,
                forceNetwork = true,
            )
        }
    }

    private fun connectedDefaultModelOptions(): List<String> =
        ProviderUiHelpers.connectedModelSpecs(
            snapshots.values.toList(),
            catalogProviders,
        )

    /**
     * When the current default is no longer among connected providers' models,
     * auto-pick the first remaining connected model (or clear).
     */
    private fun pruneOrphanDefaultModel() {
        val options = connectedDefaultModelOptions()
        val (dp, dm) = parseDefaultModelSelection()
        val current = ProviderUiHelpers.modelSpec(dp, dm)
        if (current.isEmpty()) {
            // First connect with no default: smart-pick from connected models.
            val pick = ProviderUiHelpers.resolveDefaultModelSpec("", "", options, autoPick = true)
            if (pick.isNotEmpty()) {
                defaultModelCombo.selectedItem = pick
            }
            return
        }
        if (current !in options) {
            val pick = ProviderUiHelpers.resolveDefaultModelSpec("", "", options, autoPick = true)
            defaultModelCombo.selectedItem = pick.ifEmpty { "" }
        }
    }

    private fun rebuildDefaultModelCombo() {
        val options = connectedDefaultModelOptions()
        val items = listOf("") + options
        val selected = (defaultModelCombo.selectedItem as? String)?.trim().orEmpty()
        defaultModelCombo.model = DefaultComboBoxModel(items.toTypedArray())
        when {
            selected.isNotEmpty() && selected in options -> {
                defaultModelCombo.selectedItem = selected
            }
            else -> {
                val settings = VibeflyProviderSettingsState.getInstance()
                selectDefaultModel(settings.defaultProvider, settings.defaultModel)
            }
        }
    }

    private fun selectDefaultModel(provider: String, model: String) {
        val options = connectedDefaultModelOptions()
        val resolved = ProviderUiHelpers.resolveDefaultModelSpec(
            preferredProvider = provider,
            preferredModel = model,
            options = options,
            autoPick = false,
        )
        if (resolved.isNotEmpty()) {
            defaultModelCombo.selectedItem = resolved
        } else {
            // Prefer empty over an orphan from a disconnected provider.
            defaultModelCombo.selectedIndex = if (defaultModelCombo.itemCount > 0) 0 else -1
        }
    }

    private fun parseDefaultModelSelection(): Pair<String, String> {
        val raw = (defaultModelCombo.selectedItem as? String)?.trim().orEmpty()
        return ProviderUiHelpers.parseModelSpec(raw)
    }

    private fun showError(message: String) {
        loadError = message
        if (::errorLabel.isInitialized) {
            errorLabel.text = message
            errorLabel.foreground = JBColor.RED
            errorLabel.isVisible = true
        }
    }

    private fun showStatus(message: String) {
        // Soft status (loading) — not treated as a hard load error for mutate gating
        // unless [loadError] is also set.
        if (::errorLabel.isInitialized) {
            errorLabel.text = message
            errorLabel.foreground = JBColor.GRAY
            errorLabel.isVisible = true
        }
    }

    private fun clearError() {
        loadError = null
        if (::errorLabel.isInitialized) {
            errorLabel.text = " "
            errorLabel.isVisible = false
        }
    }

    companion object {
        private val log = logger<VibeflyProvidersConfigurable>()

        /** Open Providers settings instance, if any (for agent-ready refresh). */
        private val activeInstance = AtomicReference<VibeflyProvidersConfigurable?>(null)

        /**
         * Called only when a project agent becomes READY.
         * @return true if Providers settings is open and [scheduleLoadOnAgentReady] was scheduled
         */
        fun onAgentReady(): Boolean {
            val ui = activeInstance.get() ?: return false
            SwingUtilities.invokeLater {
                if (activeInstance.get() !== ui || ui.root == null) return@invokeLater
                ui.scheduleLoadOnAgentReady()
            }
            return true
        }
    }
}
