package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class Ui2HostImplTest {

    @Test
    fun `delegates raw snapshot reads and optimistic saves`() = runBlocking {
        val initial = UiSettingsSnapshot(
            scope = "application",
            settingsJson = "{\"defaultProvider\":\"openai\"}",
            vibeflyJson = "{\"locale\":\"zh\"}",
            revision = "revision-1",
        )
        var saved: SettingsSaveRequest? = null
        val host = Ui2HostImpl(
            settingsSnapshotProvider = { scope ->
                assertEquals("application", scope)
                initial
            },
            settingsSaver = { request ->
                saved = request
                SettingsSaveResult(ok = true, revision = "revision-2")
            },
        )

        assertEquals(initial, host.getSettingsSnapshot("application"))

        val request = SettingsSaveRequest(
            scope = "application",
            vibeflyJson = "{\"locale\":\"en\"}",
            expectedRevision = initial.revision,
        )
        assertEquals("revision-2", host.saveSettings(request).revision)
        assertEquals(request, saved)
    }

    @Test
    fun `ui snapshot has no raw models or auth fields`() {
        val names = UiSettingsSnapshot::class.java.declaredFields.map { it.name }.toSet()
        assertEquals(false, "modelsJson" in names)
        assertEquals(false, "authJson" in names)
    }
}
