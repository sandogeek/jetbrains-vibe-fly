package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.util.Edt
import com.intellij.openapi.components.Service
import com.intellij.openapi.fileEditor.ex.FileEditorManagerEx
import com.intellij.openapi.project.Project

/**
 * One settings editor tab per Project. Reuses a single [VibeflySettingsVirtualFile]
 * so repeat open requests only focus the existing tab.
 */
@Service(Service.Level.PROJECT)
class VibeflySettingsTabService(private val project: Project) {
    val virtualFile: VibeflySettingsVirtualFile = VibeflySettingsVirtualFile()

    fun open() {
        Edt.later {
            if (project.isDisposed) return@later
            FileEditorManagerEx.getInstanceEx(project)
                .openFile(virtualFile, true, true)
        }
    }

    companion object {
        fun getInstance(project: Project): VibeflySettingsTabService =
            project.getService(VibeflySettingsTabService::class.java)
    }
}
