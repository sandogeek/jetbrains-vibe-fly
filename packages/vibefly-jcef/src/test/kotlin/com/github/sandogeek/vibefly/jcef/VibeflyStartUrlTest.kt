package com.github.sandogeek.vibefly.jcef

import org.junit.Assert.assertEquals
import org.junit.Test

class VibeflyStartUrlTest {

    @Test
    fun emptyRouteKeepsBase() {
        assertEquals(
            "http://vibefly/index.html",
            VibeflyStartUrl.withRoute("http://vibefly/index.html", ""),
        )
        assertEquals(
            "http://127.0.0.1:5173/",
            VibeflyStartUrl.withRoute("http://127.0.0.1:5173/", "  "),
        )
    }

    @Test
    fun appendsHashRouteToProductionUrl() {
        assertEquals(
            "http://vibefly/index.html#/settings",
            VibeflyStartUrl.withRoute("http://vibefly/index.html", "settings"),
        )
        assertEquals(
            "http://vibefly/index.html#/settings/providers",
            VibeflyStartUrl.withRoute("http://vibefly/index.html", "settings/providers"),
        )
    }

    @Test
    fun appendsHashRouteToDevUrl() {
        assertEquals(
            "http://127.0.0.1:5173/#/settings",
            VibeflyStartUrl.withRoute("http://127.0.0.1:5173/", "settings"),
        )
        assertEquals(
            "http://127.0.0.1:5173#/settings",
            VibeflyStartUrl.withRoute("http://127.0.0.1:5173", "/settings"),
        )
    }

    @Test
    fun normalizesLeadingHashAndSlash() {
        assertEquals(
            "http://vibefly/index.html#/settings",
            VibeflyStartUrl.withRoute("http://vibefly/index.html", "#/settings"),
        )
        assertEquals(
            "http://vibefly/index.html#/settings",
            VibeflyStartUrl.withRoute("http://vibefly/index.html", "#settings"),
        )
    }

    @Test
    fun replacesExistingHash() {
        assertEquals(
            "http://vibefly/index.html#/settings",
            VibeflyStartUrl.withRoute("http://vibefly/index.html#/chat", "settings"),
        )
    }

    @Test
    fun addsQueryParameterBeforeHashRoute() {
        assertEquals(
            "http://vibefly/index.html?vibeflyRpcChannel=7#/settings",
            VibeflyStartUrl.withQueryParameter(
                "http://vibefly/index.html#/settings",
                "vibeflyRpcChannel",
                "7",
            ),
        )
    }

    @Test
    fun preservesExistingQueryWhenAddingParameter() {
        assertEquals(
            "http://127.0.0.1:5173/?dev=true&vibeflyRpcChannel=8#/settings",
            VibeflyStartUrl.withQueryParameter(
                "http://127.0.0.1:5173/?dev=true#/settings",
                "vibeflyRpcChannel",
                "8",
            ),
        )
    }
}
