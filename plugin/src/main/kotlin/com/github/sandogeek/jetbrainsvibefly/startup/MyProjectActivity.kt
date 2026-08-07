package com.github.sandogeek.jetbrainsvibefly.startup

import com.github.sandogeek.jetbrainsvibefly.settings.VibeflyApplicationSettingsService
import com.github.sandogeek.jetbrainsvibefly.settings.VibeflyProjectSettingsService
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity

class MyProjectActivity : ProjectActivity {

    override suspend fun execute(project: Project) {
        // Start both watchers when a project opens; neither service starts an Agent process.
        VibeflyApplicationSettingsService.getInstance()
        VibeflyProjectSettingsService.getInstance(project)
    }
}
