package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.jetbrainsvibefly.VibeflyNotifications
import com.github.sandogeek.vibefly.jcef.rpc.Ui2Host
import com.github.sandogeek.vibefly.jcef.rpc.Ui2HostImpl
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project

/** Project-bound shared Host RPC used by a chat WebView. */
class ProjectUi2Host(
    private val project: Project,
) : Ui2Host by Ui2HostImpl(
    notifyErrorHandler = { message ->
        VibeflyNotifications.error(
            project,
            VibeflyBundle.message("agent.notify.error.title"),
            message,
        )
    },
), Disposable {

    init {
        VibeflyApplicationSettingsService.getInstance()
        VibeflyProjectSettingsService.getInstance(project)
    }

    override fun dispose() {
    }
}
