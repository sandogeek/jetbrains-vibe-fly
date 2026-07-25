package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.vibefly.jcef.rpc.CatalogProvider
import com.github.sandogeek.vibefly.jcef.rpc.ProviderSnapshot

enum class ProviderBadge {
    CUSTOM,
    API_KEY,
    OAUTH,
    CONFIGURED,
}

data class ClassifiedProviders(
    val connected: List<ProviderSnapshot>,
    val popular: List<ProviderSnapshot>,
)

object ProviderUiHelpers {

    private val displayNames = mapOf(
        "openai" to "OpenAI",
        "anthropic" to "Anthropic",
        "google" to "Google",
        "google-gemini" to "Google Gemini",
        "deepseek" to "DeepSeek",
        "groq" to "Groq",
        "mistral" to "Mistral",
        "xai" to "xAI",
        "cohere" to "Cohere",
        "openrouter" to "OpenRouter",
        "azure" to "Azure OpenAI",
        "amazon-bedrock" to "Amazon Bedrock",
        "ollama" to "Ollama",
        "github-copilot" to "GitHub Copilot",
        "zai" to "Z.ai",
        "minimax" to "MiniMax",
        "moonshot" to "Moonshot",
        "qwen" to "Qwen",
        "cerebras" to "Cerebras",
        "together" to "Together",
        "fireworks" to "Fireworks",
        "perplexity" to "Perplexity",
        "huggingface" to "Hugging Face",
        "vercel-ai-gateway" to "Vercel AI Gateway",
        "opencode" to "OpenCode",
        "kimi-coding" to "Kimi Coding",
    )

    private val descriptionKeys = setOf(
        "openai",
        "anthropic",
        "google",
        "google-gemini",
        "deepseek",
        "groq",
        "mistral",
        "xai",
        "openrouter",
        "ollama",
        "azure",
        "amazon-bedrock",
        "github-copilot",
        "cohere",
        "together",
        "fireworks",
        "perplexity",
        "huggingface",
        "cerebras",
        "minimax",
        "moonshot",
        "qwen",
        "zai",
        "vercel-ai-gateway",
        "opencode",
        "kimi-coding",
    )

    fun displayName(id: String): String =
        displayNames[id.lowercase()] ?: id

    fun description(id: String): String {
        val key = id.lowercase()
        return if (key in descriptionKeys) {
            VibeflyBundle.message("provider.description.$key")
        } else {
            VibeflyBundle.message("provider.description.default")
        }
    }

    /**
     * Connected = usable for default model / agent traffic.
     * Custom providers always count; catalog providers need a stored credential.
     * [ProviderSnapshot.isConfigured] alone (models.yml entry without key) is not enough.
     */
    fun isConnected(snap: ProviderSnapshot): Boolean {
        if (!snap.isCatalog) return true
        return snap.credential.hasApiKey || snap.credential.hasOAuth
    }

    fun classifyProviders(providers: List<ProviderSnapshot>): ClassifiedProviders {
        val connected = providers
            .filter { isConnected(it) }
            .sortedBy { displayName(it.id).lowercase() }
        val connectedIds = connected.map { it.id }.toSet()
        val popular = providers
            .filter { it.isCatalog && it.id !in connectedIds }
            .sortedBy { displayName(it.id).lowercase() }
        return ClassifiedProviders(connected = connected, popular = popular)
    }

    /**
     * Filters built-in provider entries by provider id, display name, or description.
     * An empty query keeps the original order and all entries.
     */
    fun filterBuiltInProviders(
        providers: List<ProviderSnapshot>,
        query: String,
    ): List<ProviderSnapshot> {
        val needle = query.trim().lowercase()
        if (needle.isEmpty()) return providers
        return providers.filter { provider ->
            provider.id.lowercase().contains(needle) ||
                displayName(provider.id).lowercase().contains(needle) ||
                description(provider.id).lowercase().contains(needle)
        }
    }

    /**
     * Default-model options: only models from connected providers.
     * Prefer snapshot model lists; fall back to catalog models when empty.
     */
    fun connectedModelSpecs(
        providers: List<ProviderSnapshot>,
        catalogProviders: List<CatalogProvider> = emptyList(),
    ): List<String> {
        val catalogById = catalogProviders.associate { it.id to it.models.map { m -> m.id } }
        val items = mutableListOf<String>()
        for (snap in classifyProviders(providers).connected) {
            val modelIds = snap.models.map { it.id }.ifEmpty {
                catalogById[snap.id].orEmpty()
            }
            for (modelId in modelIds) {
                val id = modelId.trim()
                if (id.isNotEmpty()) {
                    items.add("${snap.id}/$id")
                }
            }
        }
        return items.distinct()
    }

    /**
     * Resolve default model selection against [options] (connected `provider/model` specs).
     * Prefers [preferredProvider]/[preferredModel] when still available; otherwise
     * auto-picks the first option when [autoPick] is true.
     */
    fun resolveDefaultModelSpec(
        preferredProvider: String,
        preferredModel: String,
        options: List<String>,
        autoPick: Boolean = false,
    ): String {
        val preferred = modelSpec(preferredProvider, preferredModel)
        if (preferred.isNotEmpty() && preferred in options) return preferred
        if (autoPick) return options.firstOrNull().orEmpty()
        return ""
    }

    fun modelSpec(provider: String, model: String): String {
        val p = provider.trim()
        val m = model.trim()
        if (p.isEmpty() || m.isEmpty()) return ""
        return "$p/$m"
    }

    fun parseModelSpec(raw: String): Pair<String, String> {
        val text = raw.trim()
        if (text.isEmpty()) return "" to ""
        val slash = text.indexOf('/')
        if (slash <= 0) return "" to ""
        return text.substring(0, slash) to text.substring(slash + 1)
    }

    /**
     * Primary badge preference: CUSTOM > API KEY > OAUTH > CONFIGURED.
     */
    fun primaryBadge(snap: ProviderSnapshot): ProviderBadge {
        if (!snap.isCatalog) return ProviderBadge.CUSTOM
        if (snap.credential.hasApiKey) return ProviderBadge.API_KEY
        if (snap.credential.hasOAuth) return ProviderBadge.OAUTH
        return ProviderBadge.CONFIGURED
    }

    fun badgeLabel(badge: ProviderBadge): String = when (badge) {
        ProviderBadge.CUSTOM -> VibeflyBundle.message("provider.badge.custom")
        ProviderBadge.API_KEY -> VibeflyBundle.message("provider.badge.apiKey")
        ProviderBadge.OAUTH -> VibeflyBundle.message("provider.badge.oauth")
        ProviderBadge.CONFIGURED -> VibeflyBundle.message("provider.badge.configured")
    }

    fun credentialStatusText(snap: ProviderSnapshot): String {
        val parts = mutableListOf<String>()
        val cred = snap.credential
        if (cred.hasApiKey) {
            parts.add(VibeflyBundle.message("provider.credential.apiKey.set", cred.originKind))
        } else {
            parts.add(VibeflyBundle.message("provider.credential.apiKey.unset"))
        }
        if (cred.hasOAuth) {
            parts.add(VibeflyBundle.message("provider.credential.oauth.present"))
        }
        return parts.joinToString(VibeflyBundle.message("provider.credential.separator"))
    }
}
