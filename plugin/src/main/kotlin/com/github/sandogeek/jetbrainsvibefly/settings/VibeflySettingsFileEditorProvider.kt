package com.github.sandogeek.jetbrainsvibefly.settings

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/**
 * Accepts only [VibeflySettingsVirtualFile] and hides the default text editor.
 */
class VibeflySettingsFileEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean =
        VibeflySettingsVirtualFile.isSettingsFile(file)

    override fun createEditor(project: Project, file: VirtualFile): FileEditor =
        VibeflySettingsFileEditor(project, file)

    override fun getEditorTypeId(): String = EDITOR_TYPE_ID

    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR

    companion object {
        const val EDITOR_TYPE_ID: String = "vibefly.settings.editor"
    }
}
