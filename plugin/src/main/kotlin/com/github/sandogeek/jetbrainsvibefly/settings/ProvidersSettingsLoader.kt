package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.agent.VibeflyAgentService
import com.github.sandogeek.vibefly.jcef.rpc.Host2Agent
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersSnapshot
import com.intellij.openapi.project.Project

/**
 * Providers snapshot fetch used by the Settings UI.
 */
internal object ProvidersSettingsLoader {

    data class Result(
        val snapshot: ProvidersSnapshot,
    )

    fun fetch(project: Project? = null): Result =
        VibeflyAgentService.withControlForSettings(
            project = project,
            operation = "getProvidersSnapshot",
        ) { control ->
            fetchWith(control)
        }

    suspend fun fetchWith(control: Host2Agent): Result {
        val snapshot = control.getProvidersSnapshot()
        ProvidersSettingsCache.put(snapshot.agentDir, snapshot)
        return Result(snapshot)
    }
}
