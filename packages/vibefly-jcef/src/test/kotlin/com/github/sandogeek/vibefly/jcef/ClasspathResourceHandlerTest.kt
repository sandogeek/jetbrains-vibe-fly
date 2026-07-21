package com.github.sandogeek.vibefly.jcef

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ClasspathResourceHandlerTest {

    @Test
    fun resourcePathFromUrl_stripsHostAndQuery() {
        assertEquals(
            "index.html",
            ClasspathResourceHandler.resourcePathFromUrl("http://vibefly/index.html"),
        )
        assertEquals(
            "assets/main.js",
            ClasspathResourceHandler.resourcePathFromUrl("http://vibefly/assets/main.js?v=1"),
        )
        assertEquals(
            "index.html",
            ClasspathResourceHandler.resourcePathFromUrl("http://vibefly/"),
        )
    }

    @Test
    fun resourcePathFromUrl_rejectsTraversal() {
        assertNull(
            ClasspathResourceHandler.resourcePathFromUrl("http://vibefly/../secret.txt"),
        )
    }

    @Test
    fun mimeTypeFor_commonAssets() {
        assertEquals("text/html", ClasspathResourceHandler.mimeTypeFor("a.html"))
        assertEquals("text/javascript", ClasspathResourceHandler.mimeTypeFor("a.js"))
        assertEquals("text/css", ClasspathResourceHandler.mimeTypeFor("a.css"))
        assertEquals("image/png", ClasspathResourceHandler.mimeTypeFor("a.png"))
    }

    @Test
    fun contentTypeFor_addsCharsetForText() {
        assertEquals("text/html; charset=utf-8", ClasspathResourceHandler.contentTypeFor("a.html"))
        assertEquals("text/css; charset=utf-8", ClasspathResourceHandler.contentTypeFor("a.css"))
        assertNull(ClasspathResourceHandler.contentTypeFor("a.png"))
    }
}
