package com.github.sandogeek.jetbrainsvibefly.settings.editor

import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileListener
import com.intellij.openapi.vfs.VirtualFileSystem
import java.io.InputStream
import java.io.OutputStream

/**
 * In-memory VFS for the singleton Vibe Fly Settings editor tab.
 * Protocol: vibefly://settings
 */
class VibeflySettingsFileSystem private constructor() : VirtualFileSystem() {

    override fun getProtocol(): String = PROTOCOL

    override fun findFileByPath(path: String): VirtualFile? =
        if (normalizePath(path) == SETTINGS_PATH) settingsFile else null

    override fun refresh(asynchronous: Boolean) {}

    override fun refreshAndFindFileByPath(path: String): VirtualFile? = findFileByPath(path)

    override fun addVirtualFileListener(listener: VirtualFileListener) {}

    override fun removeVirtualFileListener(listener: VirtualFileListener) {}

    override fun deleteFile(requestor: Any?, vFile: VirtualFile) {
        throw UnsupportedOperationException("Vibe Fly settings file is read-only")
    }

    override fun moveFile(requestor: Any?, vFile: VirtualFile, newParent: VirtualFile) {
        throw UnsupportedOperationException("Vibe Fly settings file is read-only")
    }

    override fun renameFile(requestor: Any?, vFile: VirtualFile, newName: String) {
        throw UnsupportedOperationException("Vibe Fly settings file is read-only")
    }

    override fun createChildFile(requestor: Any?, vDir: VirtualFile, fileName: String): VirtualFile {
        throw UnsupportedOperationException("Vibe Fly settings file is read-only")
    }

    override fun createChildDirectory(requestor: Any?, vDir: VirtualFile, dirName: String): VirtualFile {
        throw UnsupportedOperationException("Vibe Fly settings file is read-only")
    }

    override fun copyFile(
        requestor: Any?,
        virtualFile: VirtualFile,
        newParent: VirtualFile,
        copyName: String,
    ): VirtualFile {
        throw UnsupportedOperationException("Vibe Fly settings file is read-only")
    }

    override fun isReadOnly(): Boolean = true

    private class SettingsVirtualFile(
        private val fs: VibeflySettingsFileSystem,
    ) : VirtualFile() {
        override fun getName(): String = DISPLAY_NAME
        override fun getFileSystem(): VirtualFileSystem = fs
        override fun getPath(): String = SETTINGS_PATH
        override fun isWritable(): Boolean = false
        override fun isDirectory(): Boolean = false
        override fun isValid(): Boolean = true
        override fun getParent(): VirtualFile? = null
        override fun getChildren(): Array<VirtualFile> = emptyArray()
        override fun getOutputStream(requestor: Any?, newModificationStamp: Long, newTimeStamp: Long): OutputStream {
            throw UnsupportedOperationException("read-only")
        }
        override fun contentsToByteArray(): ByteArray = ByteArray(0)
        override fun getTimeStamp(): Long = 0L
        override fun getLength(): Long = 0L
        override fun refresh(asynchronous: Boolean, recursive: Boolean, postRunnable: Runnable?) {
            postRunnable?.run()
        }
        override fun getInputStream(): InputStream = InputStream.nullInputStream()
        override fun getModificationStamp(): Long = 0L
    }

    companion object {
        const val PROTOCOL: String = "vibefly"
        const val SETTINGS_PATH: String = "/settings"
        const val DISPLAY_NAME: String = "Vibe Fly Settings"

        val instance: VibeflySettingsFileSystem = VibeflySettingsFileSystem()

        val settingsFile: VirtualFile = SettingsVirtualFile(instance)

        private fun normalizePath(path: String): String {
            val trimmed = path.trim()
            if (trimmed.isEmpty() || trimmed == "/") return SETTINGS_PATH
            return if (trimmed.startsWith("/")) trimmed else "/$trimmed"
        }
    }
}
