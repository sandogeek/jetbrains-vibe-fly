package com.github.sandogeek.jetbrainsvibefly.settings.editor

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.DumbAware
import com.intellij.ui.jcef.JBCefApp

/**
 * Tools → Vibe Fly Settings: open (or focus) the settings editor tab.
 */
class OpenVibeflySettingsAction : AnAction(), DumbAware {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        if (!JBCefApp.isSupported()) {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("Vibe Fly")
                .createNotification(
                    "Vibe Fly Settings",
                    "JCEF is not supported in this runtime.",
                    NotificationType.ERROR,
                )
                .notify(project)
            return
        }
        FileEditorManager.getInstance(project)
            .openFile(VibeflySettingsFileSystem.settingsFile, true)
    }
}
