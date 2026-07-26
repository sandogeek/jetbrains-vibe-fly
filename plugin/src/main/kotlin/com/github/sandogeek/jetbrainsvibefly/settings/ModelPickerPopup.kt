package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.intellij.icons.AllIcons
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.JBPopupListener
import com.intellij.openapi.ui.popup.LightweightWindowEvent
import com.intellij.ui.CollectionListModel
import com.intellij.ui.JBColor
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.Alarm
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Dimension
import java.awt.Font
import java.awt.Cursor
import java.awt.Graphics
import java.awt.Point
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import javax.swing.BorderFactory
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.JPopupMenu
import javax.swing.Icon
import javax.swing.ListCellRenderer
import javax.swing.ListSelectionModel
import javax.swing.SwingConstants
import javax.swing.SwingUtilities

/**
 * Dropdown list for [ModelPickerField]: provider scope, groups, badges, pin star, MRU tiers.
 *
 * The search field lives in the settings page ([ModelPickerField]) on purpose, not in this popup:
 * a focusable popup hosted by the Settings dialog loses the caret, because the dialog restores
 * focus to its own preferred component (the top-left search field) whenever its window is
 * re-activated. This popup is never focusable — keyboard navigation is forwarded from the field.
 *
 * Ranking runs off the EDT; the cell renderer reuses one component tree.
 */
class ModelPickerPopup(
    private val anchor: JComponent,
    private val entries: List<ModelPickerEntry>,
    private val allowFollowDefault: Boolean,
    private val onChosen: (String) -> Unit,
    private val onPinToggled: (() -> Unit)? = null,
    private val onClosed: (() -> Unit)? = null,
) {

    private data class ProviderScopeItem(val id: String, val label: String, val modelCount: Int)

    private val prefs = VibeflyModelPreferencesState.getInstance()

    // Snapshot once — pin star toggles repaint only, no re-rank while typing.
    private val pinnedSnapshot: List<String> = prefs.pinnedModelSpecs.toList()
    private val recentSnapshot: List<String> = prefs.recentModelSpecs.toList()

    private val listModel = CollectionListModel<ModelPickerRow>()
    private val list = JBList(listModel).apply {
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        visibleRowCount = 16
        cellRenderer = RowRenderer(prefs)
        border = JBUI.Borders.empty(2)
        isFocusable = false
    }

    private val truncatedLabel = JBLabel("").apply {
        foreground = JBColor.GRAY
        border = JBUI.Borders.empty(4, 8)
        isVisible = false
    }

    private val providerOptions = ModelPickerFilter.listProviders(entries)
    private val modelCountByProvider: Map<String, Int> = entries
        .groupingBy { it.providerId }
        .eachCount()
    private val allItem = ProviderScopeItem(
        id = ModelPickerFilter.ALL_PROVIDERS,
        label = VibeflyBundle.message("settings.model.picker.provider.all"),
        modelCount = entries.size,
    )
    private val providerItems: List<ProviderScopeItem> = buildList {
        add(allItem)
        providerOptions.forEach { opt ->
            add(
                ProviderScopeItem(
                    id = opt.id,
                    label = opt.label,
                    modelCount = modelCountByProvider[opt.id] ?: 0,
                ),
            )
        }
    }
    private val providerScope = AtomicReference(allItem.id)
    private val selectedProviderItem = AtomicReference(allItem)

    /** Non-focusable: clicking it must not pull the caret out of the search field. */
    private val providerButton = JButton(allItem.label, AllIcons.General.ArrowDown).apply {
        isVisible = providerOptions.size > 1
        isEnabled = providerOptions.size > 1
        isFocusable = false
        isOpaque = false
        isContentAreaFilled = false
        isBorderPainted = true
        horizontalTextPosition = SwingConstants.LEFT
        horizontalAlignment = SwingConstants.LEFT
        iconTextGap = JBUIScale.scale(6)
        margin = JBUI.insets(2, 8, 2, 6)
        border = JBUI.Borders.compound(
            JBUI.Borders.customLine(JBColor.border(), 1),
            JBUI.Borders.empty(2, 6),
        )
        toolTipText = VibeflyBundle.message("settings.model.picker.provider.tooltip")
        // Cap width so long provider names ellipsize instead of stretching the header.
        preferredSize = Dimension(JBUIScale.scale(190), JBUIScale.scale(26))
        maximumSize = preferredSize
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    private val header = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty(4, 6, 4, 6)
        isVisible = providerButton.isVisible
        add(providerButton, BorderLayout.WEST)
    }

    private val root = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty()
        isFocusable = false
        add(header, BorderLayout.NORTH)
        add(JBScrollPane(list).apply { isFocusable = false }, BorderLayout.CENTER)
        add(truncatedLabel, BorderLayout.SOUTH)
    }

    private val rankGeneration = AtomicInteger(0)
    private val alarm = Alarm(Alarm.ThreadToUse.SWING_THREAD)
    private var popup: JBPopup? = null
    private var providerChooser: JBPopup? = null
    private var providerChooserClosedAt = 0L
    private var currentSpec: String = ""
    private var query: String = ""

    init {
        providerButton.addActionListener { showProviderChooser() }
        list.addMouseListener(ListMouse())
    }

    val isVisible: Boolean
        get() = popup?.isVisible == true

    /** True when [component] belongs to this popup (or its provider chooser) — focus must not be reset. */
    fun owns(component: Component?): Boolean {
        if (component == null) return false
        if (SwingUtilities.isDescendingFrom(component, root)) return true
        // Nested provider chooser is a separate non-focusable window; some LaFs still route events.
        val chooser = providerChooser ?: return false
        val content = chooser.content ?: return false
        return SwingUtilities.isDescendingFrom(component, content)
    }

    fun show(initialQuery: String, selectedSpec: String) {
        currentSpec = selectedSpec
        query = initialQuery
        if (isVisible) {
            scheduleRank(query, selectSpec = selectedSpec.takeIf { it.isNotEmpty() })
            return
        }
        // Scope to the current model's provider so the list opens where the user left off.
        val initialProvider = entries.firstOrNull { it.spec == selectedSpec }?.providerId
            ?: ModelPickerFilter.ALL_PROVIDERS
        val item = providerItems.firstOrNull { it.id == initialProvider } ?: allItem
        providerScope.set(item.id)
        selectedProviderItem.set(item)
        providerButton.text = item.label

        val width = maxOf(anchor.width, JBUIScale.scale(460))
        root.preferredSize = Dimension(width, JBUIScale.scale(360))

        val created = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(root, null)
            // Never focusable: the caret stays in the settings page's search field.
            .setRequestFocus(false)
            .setFocusable(false)
            .setCancelOnClickOutside(true)
            .setCancelOnOtherWindowOpen(false)
            // A non-focusable popup must not cancel on deactivation: showing it can briefly
            // deactivate the dialog and close the popup right away. The field closes it on
            // focus loss instead.
            .setCancelOnWindowDeactivation(false)
            .setResizable(false)
            .setMovable(false)
            .setCancelKeyEnabled(false)
            .createPopup()
        created.addListener(object : JBPopupListener {
            override fun onClosed(event: LightweightWindowEvent) {
                rankGeneration.incrementAndGet()
                alarm.cancelAllRequests()
                providerChooser?.cancel()
                providerChooser = null
                popup = null
                onClosed?.invoke()
            }
        })
        popup = created
        scheduleRank(query, selectSpec = selectedSpec.takeIf { it.isNotEmpty() })
        created.show(RelativePoint.getSouthWestOf(anchor))
    }

    fun cancel() {
        providerChooser?.cancel()
        providerChooser = null
        popup?.cancel()
        popup = null
    }

    fun setQuery(text: String) {
        query = text
        alarm.cancelAllRequests()
        alarm.addRequest({ scheduleRank(query, selectSpec = null) }, SEARCH_DEBOUNCE_MS)
    }

    fun moveSelection(step: Int) {
        val size = listModel.size
        if (size <= 0) return
        val cur = list.selectedIndex.coerceAtLeast(0)
        val next = (cur + step).coerceIn(0, size - 1)
        list.selectedIndex = next
        list.ensureIndexIsVisible(next)
    }

    fun pageSize(): Int = list.visibleRowCount.coerceAtLeast(1)

    /** Returns false when nothing is selected — caller keeps the key event. */
    fun chooseSelected(): Boolean {
        val row = list.selectedValue ?: return false
        cancel()
        onChosen(row.entry.spec)
        return true
    }

    private fun scheduleRank(text: String, selectSpec: String?) {
        val gen = rankGeneration.incrementAndGet()
        val providerId = providerScope.get()
        ApplicationManager.getApplication().executeOnPooledThread {
            val rows = ModelPickerFilter.rank(
                entries = entries,
                query = text,
                pinnedSpecs = pinnedSnapshot,
                recentSpecs = recentSnapshot,
                includeFollowDefault = allowFollowDefault,
                providerId = providerId,
            )
            if (rankGeneration.get() != gen) return@executeOnPooledThread
            SwingUtilities.invokeLater {
                if (rankGeneration.get() != gen) return@invokeLater
                applyRows(rows, selectSpec)
            }
        }
    }

    private fun applyRows(rows: List<ModelPickerRow>, keepSelectionSpec: String?) {
        val total = rows.size
        val limited = if (total > ModelPickerFilter.MAX_RENDERED_ROWS) {
            rows.subList(0, ModelPickerFilter.MAX_RENDERED_ROWS)
        } else {
            rows
        }
        // Single replace → one model event (not N addElement fires).
        listModel.replaceAll(limited)

        when {
            total > ModelPickerFilter.MAX_RENDERED_ROWS -> {
                truncatedLabel.text = VibeflyBundle.message(
                    "settings.model.picker.truncated",
                    limited.size,
                    total,
                )
                truncatedLabel.isVisible = true
            }
            limited.isEmpty() -> {
                truncatedLabel.text = VibeflyBundle.message("settings.model.picker.empty")
                truncatedLabel.isVisible = true
            }
            else -> truncatedLabel.isVisible = false
        }

        if (keepSelectionSpec != null) {
            selectSpec(keepSelectionSpec)
        } else if (listModel.size > 0) {
            list.selectedIndex = 0
            list.ensureIndexIsVisible(0)
        }
    }

    private fun selectSpec(spec: String) {
        val wanted = spec.trim()
        for (i in 0 until listModel.size) {
            if (listModel.getElementAt(i).entry.spec == wanted) {
                list.selectedIndex = i
                list.ensureIndexIsVisible(i)
                return
            }
        }
        if (listModel.size > 0) {
            list.selectedIndex = 0
            list.ensureIndexIsVisible(0)
        }
    }

    private fun applyProviderScope(item: ProviderScopeItem) {
        val previous = providerScope.getAndSet(item.id)
        selectedProviderItem.set(item)
        providerButton.text = item.label
        providerButton.revalidate()
        providerButton.repaint()
        if (previous == item.id) return
        alarm.cancelAllRequests()
        // Keep current selection if still visible under the new scope.
        scheduleRank(query, selectSpec = currentSpec.takeIf { it.isNotEmpty() })
    }

    /**
     * Nested non-focusable list popup — not a [JPopupMenu] strip.
     * Keeps the caret in the search field and matches the model list's visual language
     * (checkmark + label + muted model count).
     */
    private fun showProviderChooser() {
        if (!providerButton.isEnabled) return
        // cancelOnClickOutside already closed it on press — this click is the toggle half.
        if (System.currentTimeMillis() - providerChooserClosedAt < REOPEN_GUARD_MS) return
        providerChooser?.takeIf { it.isVisible }?.let {
            it.cancel()
            providerChooser = null
            return
        }

        val selectedId = selectedProviderItem.get().id
        val model = CollectionListModel(providerItems)
        val chooserList = JBList(model).apply {
            selectionMode = ListSelectionModel.SINGLE_SELECTION
            visibleRowCount = providerItems.size.coerceAtMost(12)
            border = JBUI.Borders.empty(2)
            isFocusable = false
            cellRenderer = ProviderScopeRenderer(selectedId)
            selectedIndex = providerItems.indexOfFirst { it.id == selectedId }.coerceAtLeast(0)
        }

        // Hover tracks selection so the row highlights under the cursor.
        chooserList.addMouseMotionListener(object : MouseAdapter() {
            override fun mouseMoved(e: MouseEvent) {
                val idx = chooserList.locationToIndex(e.point)
                if (idx >= 0 && chooserList.selectedIndex != idx) {
                    chooserList.selectedIndex = idx
                }
            }
        })

        val content = JBScrollPane(chooserList).apply {
            isFocusable = false
            border = JBUI.Borders.empty()
            preferredSize = Dimension(
                JBUIScale.scale(220),
                (chooserList.preferredScrollableViewportSize.height + JBUIScale.scale(4))
                    .coerceAtMost(JBUIScale.scale(320)),
            )
        }

        val created = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(content, null)
            .setRequestFocus(false)
            .setFocusable(false)
            .setCancelOnClickOutside(true)
            .setCancelOnOtherWindowOpen(false)
            .setCancelOnWindowDeactivation(false)
            .setResizable(false)
            .setMovable(false)
            .setCancelKeyEnabled(false)
            .createPopup()
        created.addListener(object : JBPopupListener {
            override fun onClosed(event: LightweightWindowEvent) {
                if (providerChooser === created) {
                    providerChooser = null
                    providerChooserClosedAt = System.currentTimeMillis()
                }
            }
        })

        chooserList.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (!SwingUtilities.isLeftMouseButton(e) || e.clickCount < 1) return
                val idx = chooserList.locationToIndex(e.point)
                if (idx < 0) return
                val item = model.getElementAt(idx)
                created.cancel()
                applyProviderScope(item)
            }
        })

        providerChooser = created
        created.show(RelativePoint.getSouthWestOf(providerButton))
        chooserList.ensureIndexIsVisible(chooserList.selectedIndex)
    }

    private inner class ListMouse : MouseAdapter() {
        override fun mouseClicked(e: MouseEvent) {
            if (SwingUtilities.isRightMouseButton(e)) {
                val idx = list.locationToIndex(e.point)
                if (idx < 0) return
                list.selectedIndex = idx
                val row = listModel.getElementAt(idx)
                if (row.entry.spec.isNotEmpty()) {
                    showContextMenu(list, e.point, row, prefs) {
                        list.repaint()
                        onPinToggled?.invoke()
                    }
                }
                return
            }
            if (e.clickCount != 1 || !SwingUtilities.isLeftMouseButton(e)) return
            val idx = list.locationToIndex(e.point)
            if (idx < 0) return
            val bounds = list.getCellBounds(idx, idx) ?: return
            val row = listModel.getElementAt(idx)
            if (row.entry.spec.isNotEmpty() &&
                e.x >= bounds.x + bounds.width - JBUIScale.scale(28)
            ) {
                prefs.togglePinned(row.entry.spec)
                list.repaint()
                onPinToggled?.invoke()
                return
            }
            list.selectedIndex = idx
            chooseSelected()
        }
    }

    companion object {

        private const val SEARCH_DEBOUNCE_MS = 150
        private const val REOPEN_GUARD_MS = 200L

        private fun showContextMenu(
            list: JList<ModelPickerRow>,
            point: Point,
            row: ModelPickerRow,
            prefs: VibeflyModelPreferencesState,
            onChanged: () -> Unit,
        ) {
            val menu = JPopupMenu()
            val pinned = prefs.isPinned(row.entry.spec)
            val item = menu.add(
                if (pinned) {
                    VibeflyBundle.message("settings.model.picker.unpin")
                } else {
                    VibeflyBundle.message("settings.model.picker.pin")
                },
            )
            item.addActionListener {
                prefs.togglePinned(row.entry.spec)
                onChanged()
            }
            menu.show(list, point.x, point.y)
        }
    }


    /** Compact provider-scope row: checkmark · name · muted count. */
    private class ProviderScopeRenderer(
        private val selectedId: String,
    ) : ListCellRenderer<ProviderScopeItem> {

        private val root = JPanel(BorderLayout()).apply {
            isOpaque = true
            border = JBUI.Borders.empty(4, 8, 4, 10)
        }
        private val check = JLabel().apply {
            preferredSize = Dimension(JBUIScale.scale(16), JBUIScale.scale(16))
            horizontalAlignment = SwingConstants.CENTER
        }
        private val title = JLabel()
        private val plainFont = title.font.deriveFont(Font.PLAIN)
        private val boldFont = title.font.deriveFont(Font.BOLD)
        private val count = JLabel().apply {
            foreground = JBColor.GRAY
            font = font.deriveFont(font.size2D * 0.9f)
            border = JBUI.Borders.emptyLeft(10)
            horizontalAlignment = SwingConstants.RIGHT
        }
        private val left = JPanel().apply {
            isOpaque = false
            layout = BoxLayout(this, BoxLayout.X_AXIS)
            add(check)
            add(Box.createHorizontalStrut(JBUIScale.scale(6)))
            add(title)
            add(Box.createHorizontalGlue())
        }

        init {
            root.add(left, BorderLayout.CENTER)
            root.add(count, BorderLayout.EAST)
        }

        override fun getListCellRendererComponent(
            list: JList<out ProviderScopeItem>,
            value: ProviderScopeItem?,
            index: Int,
            isSelected: Boolean,
            cellHasFocus: Boolean,
        ): Component {
            val item = value ?: return root
            val bg = if (isSelected) list.selectionBackground else list.background
            val fg = if (isSelected) list.selectionForeground else list.foreground
            val muted = if (isSelected) list.selectionForeground else JBColor.GRAY
            root.background = bg
            title.text = item.label
            title.foreground = fg
            title.font = if (item.id == selectedId) boldFont else plainFont
            count.text = item.modelCount.toString()
            count.foreground = muted
            check.icon = if (item.id == selectedId) AllIcons.Actions.Checked else EMPTY_CHECK_ICON
            return root
        }

        companion object {
            /** Reserves checkmark column width so unselected rows stay aligned. */
            private val EMPTY_CHECK_ICON: Icon = object : Icon {
                override fun paintIcon(c: Component?, g: Graphics?, x: Int, y: Int) = Unit
                override fun getIconWidth(): Int = AllIcons.Actions.Checked.iconWidth
                override fun getIconHeight(): Int = AllIcons.Actions.Checked.iconHeight
            }
        }
    }

    /** Single reusable renderer tree — no SeparatorWithText / per-paint allocations. */
    private class RowRenderer(
        private val prefs: VibeflyModelPreferencesState,
    ) : ListCellRenderer<ModelPickerRow> {

        private val root = JPanel(BorderLayout())
        private val groupLabel = JLabel().apply {
            foreground = JBColor.GRAY
            font = font.deriveFont(Font.BOLD, font.size2D * 0.85f)
            border = JBUI.Borders.empty(6, 8, 0, 8)
        }
        private val body = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty(3, 8, 3, 4)
        }
        private val title = JLabel()
        private val modelIdLabel = JLabel().apply {
            foreground = JBColor.GRAY
            font = font.deriveFont(font.size2D * 0.9f)
            border = JBUI.Borders.emptyLeft(6)
        }
        private val badgesLabel = JLabel().apply {
            foreground = JBColor.GRAY
            font = font.deriveFont(Font.PLAIN, font.size2D * 0.85f)
            border = JBUI.Borders.emptyLeft(8)
        }
        private val star = JLabel().apply {
            horizontalAlignment = SwingConstants.CENTER
            border = JBUI.Borders.empty(0, 4, 0, 6)
            preferredSize = Dimension(JBUIScale.scale(24), JBUIScale.scale(16))
        }
        private val left = JPanel().apply {
            isOpaque = false
            layout = BoxLayout(this, BoxLayout.X_AXIS)
            add(title)
            add(modelIdLabel)
            add(badgesLabel)
            add(Box.createHorizontalGlue())
        }

        init {
            root.isOpaque = true
            body.add(left, BorderLayout.CENTER)
            body.add(star, BorderLayout.EAST)
            root.add(groupLabel, BorderLayout.NORTH)
            root.add(body, BorderLayout.CENTER)
            root.border = BorderFactory.createEmptyBorder()
        }

        override fun getListCellRendererComponent(
            list: JList<out ModelPickerRow>,
            value: ModelPickerRow?,
            index: Int,
            isSelected: Boolean,
            cellHasFocus: Boolean,
        ): Component {
            val row = value ?: return root
            val bg = if (isSelected) list.selectionBackground else list.background
            val fg = if (isSelected) list.selectionForeground else list.foreground
            val muted = if (isSelected) list.selectionForeground else JBColor.GRAY
            root.background = bg

            val showGroup = row.isFirstInGroup && row.tier != ModelPickerTier.FOLLOW_DEFAULT
            groupLabel.isVisible = showGroup
            if (showGroup) groupLabel.text = row.groupLabel

            val entry = row.entry
            title.text = entry.modelLabel
            title.foreground = fg
            if (entry.spec.isEmpty()) {
                modelIdLabel.isVisible = false
                badgesLabel.isVisible = false
                star.isVisible = false
                return root
            }
            modelIdLabel.isVisible = true
            modelIdLabel.text = entry.modelId
            modelIdLabel.foreground = muted
            if (entry.badges.isEmpty()) {
                badgesLabel.isVisible = false
            } else {
                badgesLabel.isVisible = true
                badgesLabel.text = entry.badges.joinToString("  ")
                badgesLabel.foreground = muted
            }
            star.isVisible = true
            star.icon = if (prefs.isPinned(entry.spec)) {
                AllIcons.Nodes.Favorite
            } else {
                AllIcons.Nodes.NotFavoriteOnHover
            }
            return root
        }
    }
}
