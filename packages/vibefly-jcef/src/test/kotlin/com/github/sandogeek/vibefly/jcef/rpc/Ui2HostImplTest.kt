package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class Ui2HostImplTest {

    @Test
    fun `exposes IDE helpers without a settings data plane`() = runBlocking {
        var opened: String? = null
        val host = Ui2HostImpl(
            appVersion = "9.9.9",
            openExternalUrlHandler = { opened = it },
        )

        assertEquals("9.9.9", host.getAppVersion())
        host.openExternalUrl("https://example.test")
        assertEquals("https://example.test", opened)
    }
}
