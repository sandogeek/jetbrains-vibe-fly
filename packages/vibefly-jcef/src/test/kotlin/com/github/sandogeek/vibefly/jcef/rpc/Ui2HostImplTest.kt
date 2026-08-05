package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class Ui2HostImplTest {

    @Test
    fun `tool window callbacks only expose and save model preferences`() = runBlocking {
        val initial = ModelPreferencesDto(
            recentModelSpecs = listOf("openai/gpt-4o"),
            pinnedModelSpecs = listOf("anthropic/claude-sonnet"),
        )
        var saved: ModelPreferencesDto? = null
        val ui = UiFormDto(locale = "zh")
        val host = Ui2HostImpl(
            modelPreferencesProvider = { initial },
            modelPreferencesSaver = { saved = it },
            uiSettingsProvider = { ui },
        )

        val settings = host.getIdeSettings()
        assertEquals(ProvidersFormDto(), settings.providers)
        assertEquals(CommitFormDto(), settings.commit)
        assertEquals(initial, settings.modelPreferences)
        assertEquals(ui, settings.ui)

        val next = ModelPreferencesDto(
            recentModelSpecs = listOf("openai/gpt-4.1"),
            pinnedModelSpecs = emptyList(),
        )
        host.saveIdeSettings(
            IdeSettingsDto(
                providers = ProvidersFormDto(defaultProvider = "ignored"),
                commit = CommitFormDto(customPrompt = "ignored"),
                modelPreferences = next,
                ui = UiFormDto(locale = "en"),
            ),
        )
        assertEquals(next, saved)
    }
}
