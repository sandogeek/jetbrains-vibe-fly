package com.github.sandogeek.jetbrainsvibefly.settings

import com.intellij.openapi.diagnostic.logger
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.InputStream

/**
 * Lazy classpath catalog for bundled (Oh My Pi) models.
 * Source: `catalog/bundled-catalog.json` (exported from agent-side pi-catalog).
 */
object BundledModelCatalog {

    private val log = logger<BundledModelCatalog>()

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    @Volatile
    private var loaded: CatalogData? = null

    private val loadLock = Any()

    data class Model(
        val id: String,
        val name: String,
        val api: String?,
        val contextWindow: Int?,
        val vision: Boolean,
        val inputCostPerMTok: Double?,
        val outputCostPerMTok: Double?,
        val reasoning: Boolean,
        val toolsUnsupported: Boolean,
        val priority: Int?,
    )

    @Serializable
    private data class CatalogFile(
        val providerOrder: List<String> = emptyList(),
        val providers: List<ProviderFile> = emptyList(),
    )

    @Serializable
    private data class ProviderFile(
        val id: String,
        val models: List<ModelFile> = emptyList(),
    )

    @Serializable
    private data class ModelFile(
        val id: String,
        val name: String? = null,
        val api: String? = null,
        val contextWindow: Int? = null,
        val vision: Boolean? = null,
        val inputCostPerMTok: Double? = null,
        val outputCostPerMTok: Double? = null,
        val reasoning: Boolean? = null,
        val toolsUnsupported: Boolean? = null,
        val priority: Int? = null,
    )

    private data class CatalogData(
        val providerOrder: List<String>,
        val providerRank: Map<String, Int>,
        val modelsByProvider: Map<String, List<Model>>,
    )

    fun ensureLoaded() {
        if (loaded != null) return
        synchronized(loadLock) {
            if (loaded != null) return
            loaded = loadFromClasspath()
        }
    }

    fun providerIds(): List<String> {
        ensureLoaded()
        val data = loaded ?: return emptyList()
        return data.modelsByProvider.keys.sorted()
    }

    fun providerRank(providerId: String): Int {
        ensureLoaded()
        val data = loaded ?: return 0
        return data.providerRank[providerId] ?: data.providerOrder.size
    }

    fun models(providerId: String): List<Model> {
        ensureLoaded()
        return loaded?.modelsByProvider?.get(providerId).orEmpty()
    }

    /**
     * Test seam: parse fixture JSON instead of classpath resource.
     * Resets process-wide cache.
     */
    internal fun loadFromJsonString(raw: String) {
        synchronized(loadLock) {
            loaded = parse(raw)
        }
    }

    /** Test seam: clear process cache. */
    internal fun resetForTests() {
        synchronized(loadLock) {
            loaded = null
        }
    }

    private fun loadFromClasspath(): CatalogData {
        val stream = openCatalogStream()
        if (stream == null) {
            log.warn("Bundled model catalog resource missing: catalog/bundled-catalog.json")
            return emptyData()
        }
        return try {
            stream.bufferedReader(Charsets.UTF_8).use { reader ->
                parse(reader.readText())
            }
        } catch (e: Exception) {
            log.warn("Failed to parse bundled model catalog", e)
            emptyData()
        }
    }

    private fun openCatalogStream(): InputStream? {
        val cl = BundledModelCatalog::class.java.classLoader
        return cl.getResourceAsStream("catalog/bundled-catalog.json")
            ?: cl.getResourceAsStream("/catalog/bundled-catalog.json")
    }

    private fun parse(raw: String): CatalogData {
        val file = json.decodeFromString(CatalogFile.serializer(), raw)
        val order = file.providerOrder
        val rank = order.withIndex().associate { (i, id) -> id to i }
        val modelsByProvider = LinkedHashMap<String, List<Model>>()
        for (p in file.providers) {
            val id = p.id.trim()
            if (id.isEmpty()) continue
            val models = p.models.mapNotNull { m ->
                val modelId = m.id.trim()
                if (modelId.isEmpty()) return@mapNotNull null
                Model(
                    id = modelId,
                    name = m.name?.trim()?.takeIf { it.isNotEmpty() } ?: modelId,
                    api = m.api?.trim()?.takeIf { it.isNotEmpty() },
                    contextWindow = m.contextWindow,
                    vision = m.vision == true,
                    inputCostPerMTok = m.inputCostPerMTok,
                    outputCostPerMTok = m.outputCostPerMTok,
                    reasoning = m.reasoning == true,
                    toolsUnsupported = m.toolsUnsupported == true,
                    priority = m.priority,
                )
            }
            modelsByProvider[id] = models
        }
        return CatalogData(
            providerOrder = order,
            providerRank = rank,
            modelsByProvider = modelsByProvider,
        )
    }

    private fun emptyData(): CatalogData =
        CatalogData(
            providerOrder = emptyList(),
            providerRank = emptyMap(),
            modelsByProvider = emptyMap(),
        )
}
