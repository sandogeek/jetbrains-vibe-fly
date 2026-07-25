package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.agent.VibeflyAgentService
import com.github.sandogeek.vibefly.jcef.rpc.Host2Agent
import com.github.sandogeek.vibefly.jcef.rpc.ProviderCatalog
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersSnapshot

/**
 * Shared providers catalog/snapshot fetch used by Settings UI and agent-ready warmup.
 */
internal object ProvidersSettingsLoader {

    data class Result(
        val catalog: ProviderCatalog,
        val snapshot: ProvidersSnapshot,
    )

    fun fetch(expandedAgentDir: String): Result =
        VibeflyAgentService.withControlForSettings(agentDir = expandedAgentDir) { control ->
            fetchWith(control, expandedAgentDir)
        }

    suspend fun fetchWith(control: Host2Agent, expandedAgentDir: String): Result {
        val catalog = ProvidersSettingsCache.getCatalog()
            ?: control.getProviderCatalog().also { ProvidersSettingsCache.putCatalog(it) }
        val snapshot = control.getProvidersSnapshot(expandedAgentDir)
        ProvidersSettingsCache.put(expandedAgentDir, catalog, snapshot)
        return Result(catalog, snapshot)
    }
}
