package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.ProvidersSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class ProvidersSettingsCacheTest {

    @Before
    fun clear() {
        ProvidersSettingsCache.invalidateSnapshot()
    }

    @Test
    fun testSnapshotKeyedByAgentDir() {
        val snapA = ProvidersSnapshot(agentDir = "/a", providers = emptyList())
        val snapB = ProvidersSnapshot(agentDir = "/b", providers = emptyList())
        ProvidersSettingsCache.putSnapshot("/a", snapA)
        assertEquals(snapA, ProvidersSettingsCache.getSnapshot("/a"))
        assertNull(ProvidersSettingsCache.getSnapshot("/b"))
        ProvidersSettingsCache.putSnapshot("/b", snapB)
        assertEquals(snapB, ProvidersSettingsCache.getSnapshot("/b"))
        assertNull(ProvidersSettingsCache.getSnapshot("/a"))
    }

    @Test
    fun testPutStoresSnapshot() {
        val snap = ProvidersSnapshot(agentDir = "/x", providers = emptyList())
        ProvidersSettingsCache.put("/x", snap)
        assertEquals(snap, ProvidersSettingsCache.getSnapshot("/x"))
    }

    @Test
    fun testInvalidateSnapshot() {
        val snap = ProvidersSnapshot(agentDir = "/z", providers = emptyList())
        ProvidersSettingsCache.putSnapshot("/z", snap)
        ProvidersSettingsCache.invalidateSnapshot("/z")
        assertNull(ProvidersSettingsCache.getSnapshot("/z"))
    }
}
