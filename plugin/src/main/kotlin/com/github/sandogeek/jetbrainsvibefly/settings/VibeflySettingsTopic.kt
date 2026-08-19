package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.SettingsFileChange
import com.intellij.util.messages.Topic

internal data class VibeflySettingsChanged(
    val scope: String,
    val projectRoot: String?,
    val changes: List<SettingsFileChange>,
)

internal fun interface VibeflySettingsListener {
    fun settingsChanged(event: VibeflySettingsChanged)
}

internal val VIBEFLY_SETTINGS_TOPIC: Topic<VibeflySettingsListener> = Topic.create(
    "Vibe Fly settings changed",
    VibeflySettingsListener::class.java,
)
