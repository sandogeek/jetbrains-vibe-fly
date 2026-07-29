package com.github.sandogeek.jetbrainsvibefly.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.annotations.XCollection

/**
 * Shared pin / MRU model prefs for chat, Providers default model, and Commit model pickers.
 * Orphan specs may remain in storage; UI only surfaces specs still in current entries.
 */
@Service(Service.Level.APP)
@State(
    name = "VibeflyModelPreferences",
    storages = [Storage("vibefly-model-preferences.xml")],
)
class VibeflyModelPreferencesState : PersistentStateComponent<VibeflyModelPreferencesState> {

    @XCollection(style = XCollection.Style.v2)
    var recentModelSpecs: MutableList<String> = mutableListOf()

    @XCollection(style = XCollection.Style.v2)
    var pinnedModelSpecs: MutableList<String> = mutableListOf()

    override fun getState(): VibeflyModelPreferencesState = this

    override fun loadState(state: VibeflyModelPreferencesState) {
        replace(state.recentModelSpecs, state.pinnedModelSpecs)
    }

    fun replace(recent: Iterable<String>, pinned: Iterable<String>) {
        recentModelSpecs = normalize(recent, MAX_RECENT)
        pinnedModelSpecs = normalize(pinned)
    }

    fun recordUsed(spec: String) {
        val key = spec.trim()
        if (key.isEmpty()) return
        recentModelSpecs.removeAll { it == key }
        recentModelSpecs.add(0, key)
        while (recentModelSpecs.size > MAX_RECENT) {
            recentModelSpecs.removeAt(recentModelSpecs.lastIndex)
        }
    }

    fun togglePinned(spec: String): Boolean {
        val key = spec.trim()
        if (key.isEmpty()) return false
        return if (pinnedModelSpecs.any { it == key }) {
            pinnedModelSpecs.removeAll { it == key }
            false
        } else {
            pinnedModelSpecs.removeAll { it == key }
            pinnedModelSpecs.add(0, key)
            true
        }
    }

    fun isPinned(spec: String): Boolean {
        val key = spec.trim()
        if (key.isEmpty()) return false
        return pinnedModelSpecs.any { it == key }
    }

    fun copyFrom(other: VibeflyModelPreferencesState) {
        replace(other.recentModelSpecs, other.pinnedModelSpecs)
    }

    fun snapshot(): VibeflyModelPreferencesState {
        val copy = VibeflyModelPreferencesState()
        copy.copyFrom(this)
        return copy
    }

    companion object {
        const val MAX_RECENT: Int = 8

        fun getInstance(): VibeflyModelPreferencesState =
            ApplicationManager.getApplication().getService(VibeflyModelPreferencesState::class.java)

        private fun normalize(values: Iterable<String>, limit: Int = Int.MAX_VALUE): MutableList<String> {
            val seen = mutableSetOf<String>()
            return values.asSequence()
                .map { it.trim() }
                .filter { it.isNotEmpty() && seen.add(it) }
                .take(limit)
                .toMutableList()
        }
    }
}
