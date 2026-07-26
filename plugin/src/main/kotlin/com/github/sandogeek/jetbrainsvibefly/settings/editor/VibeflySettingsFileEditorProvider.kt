package com.github.sandogeek.jetbrainsvibefly.settings.editor

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

class VibeflySettingsFileEditorProvider : FileEditorProvider, DumbAware {

    override fun accept(project: Project, file: VirtualFile): Boolean {
        if (file.fileSystem is VibeflySettingsFileSystem) return true
        return file.fileSystem.protocol == VibeflySettingsFileSystem.PROTOCOL &&
            file.path == VibeflySettingsFileSystem.SETTINGS_PATH
    }

    override fun createEditor(project: Project, file: VirtualFile): FileEditor =
        VibeflySettingsFileEditor(project, file)

    override fun getEditorTypeId(): String = EDITOR_TYPE_ID

    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR

    companion object {
        const val EDITOR_TYPE_ID: String = "vibefly-settings"
    }
}
