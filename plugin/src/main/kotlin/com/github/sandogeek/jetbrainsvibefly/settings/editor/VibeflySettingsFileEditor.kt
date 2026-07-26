package com.github.sandogeek.jetbrainsvibefly.settings.editor

import com.github.sandogeek.jetbrainsvibefly.settings.SettingsUi2Host
import com.github.sandogeek.vibefly.jcef.VibeflyBrowserPanel
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.components.JBLabel
import com.intellij.ui.jcef.JBCefApp
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.beans.PropertyChangeListener
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Editor tab hosting the Solid settings app in JCEF.
 */
class VibeflySettingsFileEditor(
    @Suppress("unused") private val project: Project,
    private val file: VirtualFile,
) : UserDataHolderBase(), FileEditor {

    private val disposable = Disposer.newDisposable("VibeflySettingsFileEditor")
    private var browserPanel: VibeflyBrowserPanel? = null
    private val component: JComponent

    init {
        component = if (!JBCefApp.isSupported()) {
            JPanel(BorderLayout()).apply {
                border = JBUI.Borders.empty(12)
                add(
                    JBLabel("JCEF is not supported in this runtime. Vibe Fly settings require JCEF."),
                    BorderLayout.NORTH,
                )
            }
        } else {
            lateinit var host: SettingsUi2Host
            host = SettingsUi2Host(
                host2UiProvider = { browserPanel?.rpc?.host2Ui },
            )
            val browser = VibeflyBrowserPanel(host, route = "settings")
            browserPanel = browser
            Disposer.register(disposable, browser)
            browser
        }
    }

    override fun getComponent(): JComponent = component

    override fun getPreferredFocusedComponent(): JComponent? = browserPanel

    override fun getName(): String = VibeflySettingsFileSystem.DISPLAY_NAME

    override fun setState(state: FileEditorState) {}

    override fun isModified(): Boolean = false

    override fun isValid(): Boolean = file.isValid

    override fun addPropertyChangeListener(listener: PropertyChangeListener) {}

    override fun removePropertyChangeListener(listener: PropertyChangeListener) {}

    override fun getFile(): VirtualFile = file

    override fun dispose() {
        Disposer.dispose(disposable)
        browserPanel = null
    }
}
