package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.util.Edt
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtil
import java.nio.file.Path

/**
 * Host persists settings with NIO temp-file + atomic replace, which bypasses VFS.
 * Application files under ~/.vibefly are also outside the project, so the IDE native
 * watcher will not update an already-open editor. After a successful Host write we
 * mark the VirtualFile dirty, refresh it, and reload any cached Document.
 */
internal object SettingsOpenEditorRefresh {
    private val log = logger<SettingsOpenEditorRefresh>()

    fun refresh(path: Path) {
        val application = ApplicationManager.getApplication()
        if (application.isDisposed) return
        Edt.later {
            if (application.isDisposed) return@later
            refreshOnEdt(path.toAbsolutePath().normalize())
        }
    }

    private fun refreshOnEdt(path: Path) {
        try {
            val fileSystem = LocalFileSystem.getInstance()
            var virtualFile = fileSystem.findFileByNioFile(path)
            if (virtualFile == null || !virtualFile.isValid) {
                // Atomic replace can drop the previous VFS entry. Reload this directory's
                // children only — never recurse, because application settings share a
                // parent with sessions/.
                val parent = fileSystem.refreshAndFindFileByNioFile(path.parent) ?: return
                VfsUtil.markDirtyAndRefresh(false, false, true, parent)
                virtualFile = fileSystem.refreshAndFindFileByNioFile(path) ?: return
            } else {
                VfsUtil.markDirtyAndRefresh(false, false, false, virtualFile)
            }
            if (!virtualFile.isValid) return
            val documentManager = FileDocumentManager.getInstance()
            val document = documentManager.getCachedDocument(virtualFile) ?: return
            documentManager.reloadFromDisk(document)
        } catch (error: Exception) {
            log.warn("Failed to refresh open settings editor for $path", error)
        }
    }
}
