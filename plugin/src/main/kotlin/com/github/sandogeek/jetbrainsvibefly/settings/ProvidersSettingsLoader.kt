package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.agent.VibeflyAgentService
import com.github.sandogeek.vibefly.jcef.rpc.Host2Agent
import com.intellij.openapi.project.Project
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersSnapshot

/**
 * Providers snapshot fetch used by the Settings UI.
 */
internal object ProvidersSettingsLoader {

    data class Result(
        val snapshot: ProvidersSnapshot,
    )

    fun fetch(expandedAgentDir: String, project: Project? = null): Result =
        VibeflyAgentService.withControlForSettings(
            project = project,
            operation = "getProvidersSnapshot",
        ) { control ->
            fetchWith(control, expandedAgentDir)
        }

    suspend fun fetchWith(control: Host2Agent, expandedAgentDir: String): Result {
        val snapshot = control.getProvidersSnapshot(expandedAgentDir)
        ProvidersSettingsCache.put(expandedAgentDir, snapshot)
        return Result(snapshot)
    }
}
