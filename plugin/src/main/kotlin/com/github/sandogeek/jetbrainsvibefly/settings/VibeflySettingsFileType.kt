package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.intellij.icons.AllIcons
import com.intellij.openapi.fileTypes.ex.FakeFileType
import com.intellij.openapi.vfs.VirtualFile
import javax.swing.Icon

/**
 * In-memory type for the settings editor tab. Avoids [com.intellij.openapi.fileTypes.UnknownFileType]
 * so the editor tab shows a settings icon instead of the unknown-file question mark.
 */
object VibeflySettingsFileType : FakeFileType() {
    override fun getName(): String = NAME

    override fun getDisplayName(): String = VibeflyBundle.message("settings.vibefly")

    override fun getDescription(): String = VibeflyBundle.message("settings.vibefly")

    override fun getIcon(): Icon = AllIcons.General.Settings

    override fun isMyFileType(file: VirtualFile): Boolean =
        VibeflySettingsVirtualFile.isSettingsFile(file)

    const val NAME: String = "VibeflySettings"
}
