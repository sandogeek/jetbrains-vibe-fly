package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.Ui2Host
import com.github.sandogeek.vibefly.jcef.rpc.Ui2HostImpl
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project

/** Project-bound shared Host RPC used by a chat WebView. */
class ProjectUi2Host(
    private val project: Project,
) : Ui2Host by Ui2HostImpl(), Disposable {

    init {
        VibeflyApplicationSettingsService.getInstance()
        VibeflyProjectSettingsService.getInstance(project)
    }

    override fun dispose() {
    }
}
