package com.github.sandogeek.jetbrainsvibefly

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.project.Project

/**
 * Balloon notifications for the "Vibe Fly" [plugin.xml] notification group.
 */
object VibeflyNotifications {
    const val GROUP_ID: String = "Vibe Fly"

    fun notify(
        project: Project,
        title: String,
        content: String,
        type: NotificationType,
    ) {
        NotificationGroupManager.getInstance()
            .getNotificationGroup(GROUP_ID)
            .createNotification(title, content, type)
            .notify(project)
    }

    fun error(project: Project, title: String, content: String) {
        notify(project, title, content, NotificationType.ERROR)
    }
}

