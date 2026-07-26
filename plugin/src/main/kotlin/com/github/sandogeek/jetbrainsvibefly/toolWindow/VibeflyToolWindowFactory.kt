package com.github.sandogeek.jetbrainsvibefly.toolWindow

import com.github.sandogeek.jetbrainsvibefly.agent.VibeflyAgentService
import com.github.sandogeek.vibefly.jcef.AgentOrigin
import com.github.sandogeek.vibefly.jcef.VibeflyBrowserPanel
import com.github.sandogeek.vibefly.jcef.rpc.Ui2HostImpl
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBLabel
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.JPanel

class VibeflyToolWindowFactory : ToolWindowFactory {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val contentFactory = ContentFactory.getInstance()
        if (!JBCefApp.isSupported()) {
            val fallback = JPanel(BorderLayout()).apply {
                border = JBUI.Borders.empty(12)
                add(
                    JBLabel("JCEF is not supported in this runtime. Vibe Fly requires the Web Browser (JCEF) plugin."),
                    BorderLayout.NORTH,
                )
            }
            toolWindow.contentManager.addContent(
                contentFactory.createContent(fallback, null, false),
            )
            return
        }

        val agentService = VibeflyAgentService.getInstance(project)
        val expectedOrigin = AgentOrigin.currentPanel()
        val ui2Host = Ui2HostImpl(
            agentConnectionProvider = {
                try {
                    agentService.openSession(expectedOrigin)
                } catch (e: Exception) {
                    log.warn("Failed to open agent session for origin=$expectedOrigin", e)
                    null
                }
            },
        )
        val panel = VibeflyBrowserPanel(ui2Host)
        val content = contentFactory.createContent(panel, null, false)
        Disposer.register(content, panel)
        toolWindow.contentManager.addContent(content)
    }

    override fun shouldBeAvailable(project: Project) = true

    companion object {
        private val log = logger<VibeflyToolWindowFactory>()
    }
}
