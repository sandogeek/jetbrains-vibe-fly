package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.intellij.icons.AllIcons
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.Dimension
import java.awt.event.FocusEvent
import java.awt.event.FocusListener
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JButton
import javax.swing.JPanel
import javax.swing.event.DocumentEvent

/**
 * Combo-like model field: shows the selected model, opens [ModelPickerPopup] on click.
 *
 * The search input is this component (inside the Settings dialog), not the popup. A focusable
 * popup owned by the Settings dialog loses the caret to the dialog's preferred focus component
 * (the top-left settings search field) on window re-activation, so the popup is kept
 * non-focusable and all keystrokes are handled here and forwarded to it.
 */
class ModelPickerField(
    private val allowFollowDefault: Boolean = false,
    private val allowClear: Boolean = false,
) : JPanel(BorderLayout()) {

    /** Doubles as display label (read-only look) and search input (editable). */
    private val editor = JBTextField().apply {
        border = JBUI.Borders.empty(0, 4)
        isOpaque = false
        isEditable = false
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }
    /** Model id hint. BorderLayout.EAST honours preferred width, so it is capped per layout pass. */
    private val secondary = object : JBLabel("") {
        override fun getPreferredSize(): Dimension {
            val natural = super.getPreferredSize()
            val cap = this@ModelPickerField.width * 2 / 5
            if (cap <= 0 || natural.width <= cap) return natural
            return Dimension(cap, natural.height)
        }
    }.apply {
        foreground = JBColor.GRAY
        border = JBUI.Borders.emptyRight(6)
        font = font.deriveFont(font.size2D * 0.9f)
    }
    private val openButton = JButton(AllIcons.General.ArrowDown).apply {
        isFocusable = false
        border = JBUI.Borders.empty(2, 4)
        isContentAreaFilled = false
        toolTipText = VibeflyBundle.message("settings.model.picker.search.placeholder")
    }

    /** Makes it readable as a search box: the field *is* the search input, the popup has none. */
    private val searchIcon = JBLabel(AllIcons.Actions.Find).apply {
        border = JBUI.Borders.empty(0, 5, 0, 2)
        toolTipText = VibeflyBundle.message("settings.model.picker.search.placeholder")
    }

    private var entries: List<ModelPickerEntry> = emptyList()
    private var selectedSpec: String = ""
    private val listeners: MutableList<(String) -> Unit> = mutableListOf()

    private var popup: ModelPickerPopup? = null
    private var searching = false
    private var suppressDocumentEvents = false
    /** Stamp of the last self-close, so the click that closed it does not reopen immediately. */
    private var lastCloseAt = 0L

    init {
        border = JBUI.Borders.customLine(JBColor.border(), 1)
        background = JBColor.namedColor("TextField.background", JBColor.background())
        isOpaque = true

        val east = JPanel(BorderLayout()).apply {
            isOpaque = false
            add(secondary, BorderLayout.CENTER)
            add(openButton, BorderLayout.EAST)
        }
        add(searchIcon, BorderLayout.WEST)
        add(editor, BorderLayout.CENTER)
        add(east, BorderLayout.EAST)

        installListeners()

        minimumSize = Dimension(JBUIScale.scale(120), JBUIScale.scale(28))
        preferredSize = Dimension(JBUIScale.scale(280), JBUIScale.scale(30))
        render()
    }

    fun addSelectionListener(listener: (String) -> Unit) {
        listeners += listener
    }

    fun getSelectedSpec(): String = selectedSpec

    fun setSelectedSpec(spec: String) {
        selectedSpec = spec.trim()
        if (!searching) render()
    }

    fun setEntries(newEntries: List<ModelPickerEntry>) {
        entries = newEntries
        // Keep selection if still present; otherwise fall back to follow/empty.
        if (selectedSpec.isNotEmpty() && entries.none { it.spec == selectedSpec }) {
            selectedSpec = ""
        }
        // The popup snapshots entries, so it must be rebuilt against the new list.
        val wasOpen = popup?.isVisible == true
        closePopup()
        if (wasOpen && searching) {
            lastCloseAt = 0L
            openPopup()
        } else if (!searching) {
            render()
        }
    }

    fun setEnabledField(enabled: Boolean) {
        isEnabled = enabled
        openButton.isEnabled = enabled
        editor.isEnabled = enabled
        secondary.isEnabled = enabled
        if (!enabled) {
            closePopup()
            exitSearch()
        }
    }

    override fun requestFocus() {
        editor.requestFocus()
    }

    override fun requestFocusInWindow(): Boolean = editor.requestFocusInWindow()

    private fun installListeners() {
        val clicker = object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) = onFieldClicked()
        }
        addMouseListener(clicker)
        editor.addMouseListener(clicker)
        secondary.addMouseListener(clicker)
        searchIcon.addMouseListener(clicker)
        openButton.addActionListener { onFieldClicked() }

        editor.addFocusListener(object : FocusListener {
            // Plain focus (Tab) must not wipe the shown model: search starts on real intent only.
            override fun focusGained(e: FocusEvent) = Unit

            override fun focusLost(e: FocusEvent) {
                // Clicks inside the popup never move focus (it is non-focusable), so any
                // real focus loss means the user left the field.
                if (popup?.owns(e.oppositeComponent) == true) return
                closePopup()
                exitSearch()
            }
        })

        editor.addKeyListener(object : KeyAdapter() {
            override fun keyPressed(e: KeyEvent) = onKeyPressed(e)

            override fun keyTyped(e: KeyEvent) = onKeyTyped(e)
        })

        editor.document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(e: DocumentEvent) {
                if (suppressDocumentEvents || !searching) return
                val open = popup
                if (open != null && open.isVisible) {
                    open.setQuery(editor.text)
                } else {
                    openPopup()
                }
            }
        })
    }

    private fun onFieldClicked() {
        if (!isEnabled) return
        val open = popup
        if (open != null && open.isVisible) {
            closePopup()
            exitSearch()
            return
        }
        // cancelOnClickOutside already closed it on mouse-press: this click is the "close" half
        // of a toggle, not a reopen.
        if (System.currentTimeMillis() - lastCloseAt < REOPEN_GUARD_MS) {
            exitSearch()
            editor.requestFocusInWindow()
            return
        }
        enterSearch()
        openPopup()
    }

    /** Typing on the read-only field starts a search with that character. */
    private fun onKeyTyped(e: KeyEvent) {
        if (!isEnabled || searching) return
        val ch = e.keyChar
        if (e.isControlDown || e.isMetaDown || e.isAltDown) return
        if (ch == KeyEvent.CHAR_UNDEFINED || Character.isISOControl(ch)) return
        if (ch == ' ') {
            // Combo convention: space opens the list rather than starting a blank query.
            enterSearch()
            openPopup()
            e.consume()
            return
        }
        enterSearch()
        editor.text = ch.toString()
        editor.caretPosition = editor.text.length
        e.consume()
    }

    private fun onKeyPressed(e: KeyEvent) {
        if (!isEnabled) return
        val open = popup?.takeIf { it.isVisible }
        when (e.keyCode) {
            KeyEvent.VK_DOWN, KeyEvent.VK_UP, KeyEvent.VK_PAGE_DOWN, KeyEvent.VK_PAGE_UP -> {
                if (open == null) {
                    enterSearch()
                    openPopup()
                } else {
                    val step = when (e.keyCode) {
                        KeyEvent.VK_DOWN -> 1
                        KeyEvent.VK_UP -> -1
                        KeyEvent.VK_PAGE_DOWN -> open.pageSize()
                        else -> -open.pageSize()
                    }
                    open.moveSelection(step)
                }
                e.consume()
            }
            KeyEvent.VK_ENTER -> {
                if (open != null && open.chooseSelected()) e.consume()
            }
            KeyEvent.VK_ESCAPE -> {
                // Consume only when we actually had something to close, so Escape can still
                // close the Settings dialog otherwise.
                if (open != null) {
                    closePopup()
                    exitSearch()
                    e.consume()
                }
            }
        }
    }

    private fun enterSearch() {
        if (searching) return
        searching = true
        editor.isEditable = true
        editor.cursor = Cursor.getPredefinedCursor(Cursor.TEXT_CURSOR)
        editor.emptyText.text = VibeflyBundle.message("settings.model.picker.search.placeholder")
        secondary.isVisible = false
        setEditorText("")
        if (!editor.isFocusOwner) editor.requestFocusInWindow()
    }

    private fun exitSearch() {
        if (!searching) return
        searching = false
        editor.isEditable = false
        editor.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        editor.emptyText.text = ""
        render()
    }

    private fun openPopup() {
        if (!isEnabled) return
        popup?.let { if (it.isVisible) return }
        // Fresh instance per open: pinned/recent are snapshotted at construction.
        var self: ModelPickerPopup? = null
        val open = ModelPickerPopup(
            anchor = this,
            entries = entries,
            allowFollowDefault = allowFollowDefault,
            onChosen = { spec -> onChosen(spec) },
            onClosed = {
                // Only drop the reference if a newer popup has not replaced it.
                if (popup === self) popup = null
                lastCloseAt = System.currentTimeMillis()
            },
        )
        self = open
        popup = open
        open.show(initialQuery = if (searching) editor.text else "", selectedSpec = selectedSpec)
    }

    private fun closePopup() {
        val open = popup ?: return
        popup = null
        open.cancel()
        lastCloseAt = System.currentTimeMillis()
    }

    private fun onChosen(spec: String) {
        val next = when {
            spec.isEmpty() && (allowFollowDefault || allowClear) -> ""
            spec.isEmpty() -> selectedSpec
            else -> spec
        }
        val changed = next != selectedSpec
        selectedSpec = next
        popup = null
        // Deliberate close: the next click should reopen without hitting the toggle guard.
        lastCloseAt = 0L
        exitSearch()
        // Keep the caret in this field: the popup never owned it.
        editor.requestFocusInWindow()
        if (changed) listeners.forEach { it(selectedSpec) }
    }

    private fun render() {
        val spec = selectedSpec
        val text: String
        var secondaryText = ""
        if (spec.isEmpty()) {
            text = when {
                allowFollowDefault -> VibeflyBundle.message("settings.model.picker.followDefault")
                allowClear -> VibeflyBundle.message("settings.model.picker.clear")
                else -> ""
            }
        } else {
            val entry = entries.firstOrNull { it.spec == spec }
            if (entry != null) {
                text = VibeflyBundle.message(
                    "settings.model.picker.display.providerModel",
                    entry.providerLabel,
                    entry.modelLabel,
                )
                // Only worth showing when it adds something the label does not already say.
                secondaryText = if (entry.modelId == entry.modelLabel) "" else entry.modelId
            } else {
                val (p, m) = ProviderUiHelpers.parseModelSpec(spec)
                if (p.isNotEmpty() && m.isNotEmpty()) {
                    text = VibeflyBundle.message(
                        "settings.model.picker.display.providerModel",
                        ProviderUiHelpers.displayName(p),
                        m,
                    )
                } else {
                    text = spec
                }
            }
        }
        setEditorText(text)
        secondary.text = secondaryText
        secondary.isVisible = secondaryText.isNotEmpty()
    }

    private fun setEditorText(text: String) {
        suppressDocumentEvents = true
        try {
            editor.text = text
            editor.caretPosition = 0
        } finally {
            suppressDocumentEvents = false
        }
    }

    companion object {
        private const val REOPEN_GUARD_MS = 250L
    }
}
