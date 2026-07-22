package com.github.sandogeek.vibefly.jcef

import org.junit.Assert.assertEquals
import org.junit.Test

class AgentOriginTest {
    @Test
    fun productionOmitsDefaultHttpPort() {
        assertEquals("http://vibefly", AgentOrigin.fromStartUrl("http://vibefly/index.html"))
        assertEquals("http://vibefly", AgentOrigin.production())
    }

    @Test
    fun viteOriginKeepsNonDefaultPort() {
        assertEquals(
            "http://127.0.0.1:5173",
            AgentOrigin.fromStartUrl("http://127.0.0.1:5173/"),
        )
    }

    @Test
    fun httpsDefaultPortOmitted() {
        assertEquals("https://example.com", AgentOrigin.fromStartUrl("https://example.com/app"))
        assertEquals(
            "https://example.com:8443",
            AgentOrigin.fromStartUrl("https://example.com:8443/x"),
        )
    }
}
