package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.ProviderCatalog
import com.github.sandogeek.vibefly.jcef.rpc.ProvidersSnapshot

/**
 * In-memory cache so Providers settings can paint immediately on open
 * while a background refresh runs against the agent.
 */
internal object ProvidersSettingsCache {
    private val lock = Any()

    private var catalog: ProviderCatalog? = null
    private var snapshotAgentDir: String? = null
    private var snapshot: ProvidersSnapshot? = null

    fun getCatalog(): ProviderCatalog? = synchronized(lock) { catalog }

    fun putCatalog(value: ProviderCatalog) {
        synchronized(lock) {
            catalog = value
        }
    }

    fun getSnapshot(agentDir: String): ProvidersSnapshot? = synchronized(lock) {
        if (snapshotAgentDir == agentDir) snapshot else null
    }

    fun putSnapshot(agentDir: String, value: ProvidersSnapshot) {
        synchronized(lock) {
            snapshotAgentDir = agentDir
            snapshot = value
        }
    }

    fun put(agentDir: String, catalogValue: ProviderCatalog, snapshotValue: ProvidersSnapshot) {
        synchronized(lock) {
            catalog = catalogValue
            snapshotAgentDir = agentDir
            snapshot = snapshotValue
        }
    }

    fun invalidateSnapshot(agentDir: String? = null) {
        synchronized(lock) {
            if (agentDir == null || agentDir == snapshotAgentDir) {
                snapshotAgentDir = null
                snapshot = null
            }
        }
    }
}
