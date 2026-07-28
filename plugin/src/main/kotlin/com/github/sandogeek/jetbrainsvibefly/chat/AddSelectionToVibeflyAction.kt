package com.github.sandogeek.jetbrainsvibefly.chat

import com.github.sandogeek.vibefly.jcef.rpc.HostChatContextItem
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.wm.ToolWindowManager
import java.nio.file.Path
import java.util.UUID

class AddSelectionToVibeflyAction : AnAction() {
    override fun update(event: AnActionEvent) {
        val editor = event.getData(CommonDataKeys.EDITOR)
        val file = event.getData(CommonDataKeys.VIRTUAL_FILE)
        event.presentation.isEnabledAndVisible =
            event.project != null && editor?.selectionModel?.hasSelection() == true && file?.isInLocalFileSystem == true
    }

    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val editor = event.getData(CommonDataKeys.EDITOR) ?: return
        val file = event.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val projectRoot = runCatching { project.basePath?.let(Path::of)?.toRealPath() }.getOrNull() ?: return
        val filePath = runCatching { Path.of(file.path).toRealPath() }.getOrNull() ?: return
        if (!filePath.startsWith(projectRoot)) return

        val selection = editor.selectionModel
        val rawText = selection.selectedText ?: return
        val text = truncateUtf8(rawText, MAX_SELECTION_BYTES)
        val document = editor.document
        val startLine = document.getLineNumber(selection.selectionStart) + 1
        val endOffset = (selection.selectionEnd - 1).coerceAtLeast(selection.selectionStart)
        val endLine = document.getLineNumber(endOffset) + 1
        val relativePath = projectRoot.relativize(filePath).toString().replace('\\', '/')

        ChatContextDeliveryService.getInstance(project).offer(
            listOf(
                HostChatContextItem(
                    id = UUID.randomUUID().toString(),
                    kind = "selection",
                    path = relativePath,
                    text = text,
                    startLine = startLine,
                    endLine = endLine,
                ),
            ),
        )
        ToolWindowManager.getInstance(project).getToolWindow("Vibe Fly")?.show()
    }

    internal fun truncateUtf8(value: String, maxBytes: Int): String {
        val bytes = value.toByteArray(Charsets.UTF_8)
        if (bytes.size <= maxBytes) return value
        var end = maxBytes
        while (end > 0 && (bytes[end].toInt() and 0xC0) == 0x80) end -= 1
        return bytes.copyOf(end).toString(Charsets.UTF_8)
    }

    companion object {
        const val MAX_SELECTION_BYTES: Int = 256 * 1024
    }
}
