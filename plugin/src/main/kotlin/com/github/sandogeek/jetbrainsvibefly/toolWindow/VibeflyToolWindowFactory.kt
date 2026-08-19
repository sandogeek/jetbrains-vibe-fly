package com.github.sandogeek.jetbrainsvibefly.toolWindow

import com.github.sandogeek.jetbrainsvibefly.agent.VibeflyAgentService
import com.github.sandogeek.jetbrainsvibefly.chat.ChatContextDeliveryService
import com.github.sandogeek.jetbrainsvibefly.chat.ChatToolWindowCommandService
import com.github.sandogeek.jetbrainsvibefly.chat.ChatWorkspaceState
import com.github.sandogeek.jetbrainsvibefly.settings.ProjectUi2Host
import com.github.sandogeek.jetbrainsvibefly.settings.VibeflySettingsTabService
import com.github.sandogeek.jetbrainsvibefly.util.Edt
import com.github.sandogeek.vibefly.jcef.AgentOrigin
import com.github.sandogeek.vibefly.jcef.VibeflyBrowserPanel
import com.github.sandogeek.vibefly.jcef.rpc.HostChatContextItem
import com.github.sandogeek.vibefly.jcef.rpc.Ui2HostChatImpl
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vcs.changes.ChangeListManager
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBLabel
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.nio.file.Files
import java.nio.file.Path
import java.util.*
import javax.swing.JPanel

class VibeflyToolWindowFactory : ToolWindowFactory {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val contentFactory = ContentFactory.getInstance()
        if (!JBCefApp.isSupported()) {
            installTitleActions(project, toolWindow, jcefAvailable = false)
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

        installTitleActions(project, toolWindow, jcefAvailable = true)
        val agentService = VibeflyAgentService.getInstance(project)
        val projectRoot = project.basePath.orEmpty()
        val workspaceState = ChatWorkspaceState.getInstance(project)
        val contextDelivery = ChatContextDeliveryService.getInstance(project)
        val commandService = ChatToolWindowCommandService.getInstance(project)
        val expectedOrigin = AgentOrigin.currentPanel()
        var panel: VibeflyBrowserPanel? = null
        val ui2Host = ProjectUi2Host(project)
        val ui2HostChat = Ui2HostChatImpl(
            agentConnectionProvider = {
                try {
                    agentService.openSession(expectedOrigin)
                } catch (e: Exception) {
                    log.warn("Failed to open agent session for origin=$expectedOrigin", e)
                    null
                }
            },
            projectRootProvider = { projectRoot },
            workspaceStateProvider = { workspaceState.snapshot() },
            workspaceStateSaver = { state -> workspaceState.replace(state) },
            openProjectFileHandler = { relativePath, line ->
                Edt.run {
                    openProjectFile(project, projectRoot, relativePath, line)
                }
            },
            refreshProjectFilesHandler = { relativePaths ->
                refreshProjectFiles(projectRoot, relativePaths)
            },
            showProjectDiffHandler = { relativePath ->
                Edt.run {
                    showProjectDiff(project, projectRoot, relativePath)
                }
            },
            selectChatContextFilesHandler = {
                Edt.run {
                    selectContextFiles(project, projectRoot)
                }
            },
            chatUiReadyHandler = {
                contextDelivery.retry()
                commandService.retry()
                // Host2Ui is registered; push current LAF mode (no CSS batch).
                panel?.applyTheme(retry = false)
            },
            openIdeSettingsHandler = {
                Edt.run {
                    VibeflySettingsTabService.getInstance(project).open()
                }
            },
        )
        panel = VibeflyBrowserPanel(
            ui2Host = ui2Host,
            ui2HostChat = ui2HostChat,
            onFilesDropped = { paths ->
                val relativePaths = projectRelativeFiles(projectRoot, paths)
                if (relativePaths.isNotEmpty()) {
                    contextDelivery.offer(
                        relativePaths.map { relativePath ->
                            HostChatContextItem(
                                id = UUID.randomUUID().toString(),
                                kind = "file",
                                path = relativePath,
                            )
                        },
                    )
                }
            },
        )
        val browserPanel = panel
        Disposer.register(browserPanel, ui2Host)
        contextDelivery.bind { sessionId, contexts ->
            browserPanel.rpc.host2UiChat.addChatContexts(sessionId, contexts)
        }
        commandService.bind {
            browserPanel.rpc.host2UiChat.createNewSession()
        }
        val content = contentFactory.createContent(browserPanel, null, false)
        Disposer.register(content, browserPanel)
        toolWindow.contentManager.addContent(content)
    }

    override fun shouldBeAvailable(project: Project) = true

    private fun installTitleActions(project: Project, toolWindow: ToolWindow, jcefAvailable: Boolean) {
        toolWindow.setTitleActions(
            listOf(
                NewChatSessionTitleAction(project, jcefAvailable),
                OpenSettingsTitleAction(project),
            ),
        )
    }

    private fun openProjectFile(project: Project, root: String, relativePath: String, line: Int?) {
        val filePath = resolveProjectPath(root, relativePath) ?: return
        if (!Files.isRegularFile(filePath)) return
        val virtualFile = LocalFileSystem.getInstance().findFileByPath(filePath.toString()) ?: return
        val descriptor = OpenFileDescriptor(project, virtualFile, (line ?: 1).coerceAtLeast(1) - 1, 0)
        FileEditorManager.getInstance(project).openTextEditor(descriptor, true)
    }

    private fun refreshProjectFiles(root: String, relativePaths: List<String>) {
        val localFileSystem = LocalFileSystem.getInstance()
        relativePaths.forEach { relativePath ->
            resolveProjectPath(root, relativePath)
                ?.let { localFileSystem.refreshAndFindFileByIoFile(it.toFile()) }
                ?.refresh(false, false)
        }
    }

    private fun showProjectDiff(project: Project, root: String, relativePath: String) {
        val filePath = resolveProjectPath(root, relativePath) ?: return
        if (!Files.isRegularFile(filePath)) return
        val virtualFile = LocalFileSystem.getInstance().findFileByPath(filePath.toString()) ?: return
        val change = ChangeListManager.getInstance(project).getChange(virtualFile)
        val before = runCatching { change?.beforeRevision?.content }.getOrNull()
        if (change == null || before == null) {
            openProjectFile(project, root, relativePath, null)
            return
        }
        val factory = DiffContentFactory.getInstance()
        val request = SimpleDiffRequest(
            "Vibe Fly Diff: $relativePath",
            factory.create(project, before),
            factory.create(project, virtualFile),
            change.beforeRevision?.revisionNumber?.asString() ?: "Before",
            "Working tree",
        )
        DiffManager.getInstance().showDiff(project, request)
    }

    private fun selectContextFiles(project: Project, root: String): List<String> {
        val descriptor = FileChooserDescriptor(true, false, false, false, false, true).apply {
            title = "Add Files to Vibe Fly"
        }
        val chosen = FileChooser.chooseFiles(descriptor, project, project.projectFile)
        return projectRelativeFiles(root, chosen.map { it.path })
    }

    private fun projectRelativeFiles(root: String, paths: List<String>): List<String> {
        val rootPath = runCatching { Path.of(root).toRealPath() }.getOrNull() ?: return emptyList()
        return paths.mapNotNull { raw ->
            runCatching {
                val candidate = Path.of(raw).toRealPath()
                if (!candidate.startsWith(rootPath) || !candidate.toFile().isFile) null
                else rootPath.relativize(candidate).toString().replace('\\', '/')
            }.getOrNull()
        }.distinct()
    }

    private fun resolveProjectPath(root: String, relativePath: String): Path? = runCatching {
        if (root.isBlank() || relativePath.isBlank()) return@runCatching null
        val rootPath = Path.of(root).toRealPath()
        val relative = Path.of(relativePath)
        if (relative.isAbsolute) return@runCatching null
        val candidate = rootPath.resolve(relative).normalize()
        if (!candidate.startsWith(rootPath)) return@runCatching null

        var existing = candidate
        while (!Files.exists(existing) && existing.parent != null) existing = existing.parent
        val resolved = existing.toRealPath().resolve(existing.relativize(candidate)).normalize()
        resolved.takeIf { it.startsWith(rootPath) }
    }.getOrNull()

    companion object {
        private val log = logger<VibeflyToolWindowFactory>()
    }
}
