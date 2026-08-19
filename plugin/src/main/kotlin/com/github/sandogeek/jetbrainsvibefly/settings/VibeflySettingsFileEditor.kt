package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.vibefly.jcef.VibeflyBrowserPanel
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorLocation
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.fileEditor.FileEditorStateLevel
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.components.JBLabel
import com.intellij.ui.jcef.JBCefApp
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.beans.PropertyChangeListener
import java.beans.PropertyChangeSupport
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Hosts the settings React app in JCEF. Closing the tab disposes RPC, Host, and browser.
 */
class VibeflySettingsFileEditor(
    project: Project,
    private val file: VirtualFile,
) : UserDataHolderBase(), FileEditor {

    private val propertyChangeSupport = PropertyChangeSupport(this)
    private val editorComponent: JComponent
    private var browserPanel: VibeflyBrowserPanel? = null
    private var valid = true

    init {
        if (!JBCefApp.isSupported()) {
            editorComponent = JPanel(BorderLayout()).apply {
                border = JBUI.Borders.empty(12)
                add(
                    JBLabel("JCEF is not supported in this runtime. Vibe Fly settings require JCEF."),
                    BorderLayout.NORTH,
                )
            }
        } else {
            lateinit var host: SettingsUi2Host
            host = SettingsUi2Host(
                project = project,
                host2UiSettingsProvider = { browserPanel?.rpc?.host2UiSettings },
            )
            Disposer.register(this, host)
            val browser = VibeflyBrowserPanel(
                ui2Host = host,
                ui2HostSettings = host,
                route = "settings",
            )
            browserPanel = browser
            Disposer.register(this, browser)
            editorComponent = browser
        }
    }

    override fun getComponent(): JComponent = editorComponent

    override fun getPreferredFocusedComponent(): JComponent = editorComponent

    override fun getName(): String = VibeflyBundle.message("settings.vibefly")

    override fun getFile(): VirtualFile = file

    override fun getState(level: FileEditorStateLevel): FileEditorState = FileEditorState.INSTANCE

    override fun setState(state: FileEditorState) {}

    override fun isModified(): Boolean = false

    override fun isValid(): Boolean = valid

    override fun addPropertyChangeListener(listener: PropertyChangeListener) {
        propertyChangeSupport.addPropertyChangeListener(listener)
    }

    override fun removePropertyChangeListener(listener: PropertyChangeListener) {
        propertyChangeSupport.removePropertyChangeListener(listener)
    }

    override fun getCurrentLocation(): FileEditorLocation? = null

    override fun dispose() {
        valid = false
        browserPanel = null
    }
}
