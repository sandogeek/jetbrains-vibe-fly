package com.github.sandogeek.jetbrainsvibefly.toolWindow

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.jetbrainsvibefly.chat.ChatToolWindowCommandService
import com.github.sandogeek.jetbrainsvibefly.settings.VibeflySettingsTabService
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project

internal class NewChatSessionTitleAction(
    private val project: Project,
    private val jcefAvailable: Boolean,
) : DumbAwareAction(
    VibeflyBundle.messagePointer("toolwindow.newSession"),
    VibeflyBundle.messagePointer("toolwindow.newSession.description"),
    AllIcons.General.Add,
) {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabled = jcefAvailable && !project.isDisposed
    }

    override fun actionPerformed(event: AnActionEvent) {
        if (!jcefAvailable || project.isDisposed) return
        ChatToolWindowCommandService.getInstance(project).requestNewSession()
    }
}

internal class OpenSettingsTitleAction(
    private val project: Project,
) : DumbAwareAction(
    VibeflyBundle.messagePointer("toolwindow.openSettings"),
    VibeflyBundle.messagePointer("toolwindow.openSettings.description"),
    AllIcons.General.GearPlain,
) {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabled = !project.isDisposed
    }

    override fun actionPerformed(event: AnActionEvent) {
        if (project.isDisposed) return
        VibeflySettingsTabService.getInstance(project).open()
    }
}
