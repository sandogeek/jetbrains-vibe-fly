package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.intellij.openapi.fileTypes.UnknownFileType
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.testFramework.LightVirtualFile

/**
 * Dedicated in-memory file that hosts the project-scoped settings editor tab.
 * Identity is instance-based: each [VibeflySettingsTabService] caches one file.
 */
class VibeflySettingsVirtualFile : LightVirtualFile(
    VibeflyBundle.message("settings.vibefly"),
    UnknownFileType.INSTANCE,
    "",
) {
    init {
        isWritable = false
    }

    companion object {
        fun isSettingsFile(file: VirtualFile): Boolean = file is VibeflySettingsVirtualFile
    }
}
