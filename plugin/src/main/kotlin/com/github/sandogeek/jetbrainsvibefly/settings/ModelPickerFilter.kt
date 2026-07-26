package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.vibefly.jcef.rpc.ProviderModelSnapshot
import com.github.sandogeek.vibefly.jcef.rpc.ProviderSnapshot
import java.util.Locale

enum class ModelPickerTier {
    FOLLOW_DEFAULT,
    PINNED,
    RECENT,
    NORMAL,
}

data class ModelPickerEntry(
    val spec: String,
    val providerId: String,
    val providerLabel: String,
    val modelId: String,
    val modelLabel: String,
    val providerRank: Int,
    val modelPriority: Int,
    val badges: List<String>,
    /** Pre-lowercased search blob: provider + label + model id + name. */
    val haystack: String,
    val providerIdLower: String,
    val providerLabelLower: String,
    val modelIdLower: String,
    val modelLabelLower: String,
)

data class ModelPickerRow(
    val entry: ModelPickerEntry,
    val tier: ModelPickerTier,
    val groupLabel: String,
    val isFirstInGroup: Boolean,
)

/**
 * Pure filter/rank helpers for the searchable model picker.
 * Designed for multi-thousand entry catalogs: cheap scoring, no EDT assumptions.
 */
object ModelPickerFilter {

    const val MAX_RENDERED_ROWS: Int = 500

    /** Sentinel / blank = no provider restriction (All providers). */
    const val ALL_PROVIDERS: String = ""

    private val WHITESPACE = Regex("\\s+")

    private val NORMAL_ORDER = compareBy<ModelPickerEntry> { it.providerRank }
        .thenBy { it.providerLabelLower }
        .thenBy { it.modelPriority }
        .thenBy { it.modelLabelLower }
        .thenBy { it.modelIdLower }

    fun buildEntries(connectedSnapshots: List<ProviderSnapshot>): List<ModelPickerEntry> {
        val connected = ProviderUiHelpers.classifyProviders(connectedSnapshots).connected
        val out = ArrayList<ModelPickerEntry>(256)
        for (snap in connected) {
            val providerId = snap.id
            val providerLabel = ProviderUiHelpers.displayName(providerId)
            val providerRank = BundledModelCatalog.providerRank(providerId)
            if (snap.isCatalog) {
                for (m in BundledModelCatalog.models(providerId)) {
                    out += entryFromBundled(providerId, providerLabel, providerRank, m)
                }
            } else {
                for (m in snap.models) {
                    out += entryFromCustom(providerId, providerLabel, providerRank, m)
                }
            }
        }
        // Pre-sort so empty-query rank can skip a full sort of thousands of rows.
        out.sortWith(NORMAL_ORDER)
        return out
    }

    fun rank(
        entries: List<ModelPickerEntry>,
        query: String,
        pinnedSpecs: List<String>,
        recentSpecs: List<String>,
        includeFollowDefault: Boolean,
        providerId: String? = null,
    ): List<ModelPickerRow> {
        val scopedProvider = providerId?.trim()?.takeIf { it.isNotEmpty() }
        val scoped = if (scopedProvider == null) {
            entries
        } else {
            entries.filter { it.providerId == scopedProvider }
        }

        val bySpec = HashMap<String, ModelPickerEntry>(scoped.size)
        for (e in scoped) bySpec[e.spec] = e

        val pinnedInEntries = ArrayList<ModelPickerEntry>(pinnedSpecs.size)
        val pinnedSet = HashSet<String>(pinnedSpecs.size * 2)
        for (spec in pinnedSpecs) {
            val e = bySpec[spec] ?: continue
            if (pinnedSet.add(e.spec)) pinnedInEntries += e
        }

        val recentInEntries = ArrayList<ModelPickerEntry>(recentSpecs.size)
        val recentSet = HashSet<String>(recentSpecs.size * 2)
        for (spec in recentSpecs) {
            if (spec in pinnedSet) continue
            val e = bySpec[spec] ?: continue
            if (recentSet.add(e.spec)) recentInEntries += e
        }

        val tokens = tokenizeQuery(query)
        val hasQuery = tokens.isNotEmpty()

        // Score map only when searching. Empty query keeps pre-sorted entry order.
        val scored: HashMap<String, Int>? = if (!hasQuery) {
            null
        } else {
            val map = HashMap<String, Int>(scoped.size)
            for (e in scoped) {
                val score = scoreEntry(e, tokens) ?: continue
                map[e.spec] = score
            }
            map
        }

        val rows = ArrayList<ModelPickerRow>(
            minOf(scoped.size + 1, MAX_RENDERED_ROWS + 32),
        )

        // Follow-default is not tied to a provider; keep it visible in any scope.
        if (includeFollowDefault && matchesFollowDefault(tokens)) {
            rows += ModelPickerRow(
                entry = followDefaultEntry(),
                tier = ModelPickerTier.FOLLOW_DEFAULT,
                groupLabel = VibeflyBundle.message("settings.model.picker.group.followDefault"),
                isFirstInGroup = true,
            )
        }

        appendTier(
            rows = rows,
            entries = if (scored == null) pinnedInEntries else pinnedInEntries.filter { it.spec in scored },
            tier = ModelPickerTier.PINNED,
            groupLabel = VibeflyBundle.message("settings.model.picker.group.pinned"),
            preserveOrder = true,
        )
        appendTier(
            rows = rows,
            entries = if (scored == null) recentInEntries else recentInEntries.filter { it.spec in scored },
            tier = ModelPickerTier.RECENT,
            groupLabel = VibeflyBundle.message("settings.model.picker.group.recent"),
            preserveOrder = true,
        )

        val normal = ArrayList<ModelPickerEntry>(scoped.size)
        if (scored == null) {
            for (e in scoped) {
                if (e.spec !in pinnedSet && e.spec !in recentSet) normal += e
            }
            // Sort even if buildEntries pre-sorted — callers may pass ad-hoc lists.
            normal.sortWith(NORMAL_ORDER)
        } else {
            for (e in scoped) {
                if (e.spec in pinnedSet || e.spec in recentSet) continue
                if (e.spec !in scored) continue
                normal += e
            }
            normal.sortWith(
                compareByDescending<ModelPickerEntry> { scored[it.spec] ?: 0 }
                    .thenBy { it.providerRank }
                    .thenBy { it.providerLabelLower }
                    .thenBy { it.modelPriority }
                    .thenBy { it.modelLabelLower }
                    .thenBy { it.modelIdLower },
            )
        }

        // Single-provider scope already names the filter; hide redundant group headers.
        val hideProviderGroups = scopedProvider != null
        var lastGroup: String? = null
        for (e in normal) {
            val group = e.providerLabel
            val first = if (hideProviderGroups) false else group != lastGroup
            lastGroup = group
            rows += ModelPickerRow(
                entry = e,
                tier = ModelPickerTier.NORMAL,
                groupLabel = if (hideProviderGroups) "" else group,
                isFirstInGroup = first,
            )
        }
        return rows
    }

    /**
     * Distinct providers present in [entries], ordered by catalog rank then label.
     * Used to populate the provider scope combo.
     */
    fun listProviders(entries: List<ModelPickerEntry>): List<ProviderOption> {
        if (entries.isEmpty()) return emptyList()
        val best = LinkedHashMap<String, ModelPickerEntry>(32)
        for (e in entries) {
            val prev = best[e.providerId]
            if (prev == null ||
                e.providerRank < prev.providerRank ||
                (e.providerRank == prev.providerRank && e.providerLabelLower < prev.providerLabelLower)
            ) {
                best[e.providerId] = e
            }
        }
        return best.values
            .sortedWith(
                compareBy<ModelPickerEntry> { it.providerRank }
                    .thenBy { it.providerLabelLower }
                    .thenBy { it.providerIdLower },
            )
            .map { ProviderOption(id = it.providerId, label = it.providerLabel) }
    }

    data class ProviderOption(
        val id: String,
        val label: String,
    )

    fun buildBadges(
        contextWindow: Int?,
        inputCost: Double?,
        outputCost: Double?,
        reasoning: Boolean,
        vision: Boolean,
        toolsUnsupported: Boolean,
    ): List<String> {
        val badges = ArrayList<String>(3)
        formatContextBadge(contextWindow)?.let { badges += it }
        formatCostBadge(inputCost, outputCost)?.let {
            if (badges.size < 3) badges += it
        }
        if (reasoning && badges.size < 3) {
            badges += VibeflyBundle.message("settings.model.picker.badge.reasoning")
        }
        if (vision && badges.size < 3) {
            badges += VibeflyBundle.message("settings.model.picker.badge.vision")
        }
        if (toolsUnsupported && badges.size < 3) {
            badges += VibeflyBundle.message("settings.model.picker.badge.noTools")
        }
        return badges
    }

    fun formatContextBadge(contextWindow: Int?): String? {
        if (contextWindow == null || contextWindow <= 0) return null
        return when {
            contextWindow >= 1_000_000 -> {
                val m = contextWindow / 1_000_000.0
                if (m == m.toLong().toDouble()) "${m.toLong()}M" else {
                    trimTrailingZeros(String.format(Locale.US, "%.1f", m)) + "M"
                }
            }
            contextWindow >= 1000 -> {
                val k = contextWindow / 1000.0
                if (k == k.toLong().toDouble()) "${k.toLong()}K" else {
                    trimTrailingZeros(String.format(Locale.US, "%.1f", k)) + "K"
                }
            }
            else -> contextWindow.toString()
        }
    }

    fun formatCostBadge(inputCost: Double?, outputCost: Double?): String? {
        if (inputCost == null || outputCost == null) return null
        if (inputCost == 0.0 && outputCost == 0.0) {
            return VibeflyBundle.message("settings.model.picker.badge.free")
        }
        return "$${formatCostNumber(inputCost)}/$${formatCostNumber(outputCost)}"
    }

    fun scoreEntry(entry: ModelPickerEntry, tokens: List<QueryToken>): Int? {
        if (tokens.isEmpty()) return 0
        var total = 0
        for (token in tokens) {
            val s = scoreToken(entry, token) ?: return null
            total += s
        }
        return total
    }

    fun tokenizeQuery(query: String): List<QueryToken> {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return emptyList()
        val lower = trimmed.lowercase(Locale.ROOT)
        val parts = lower.split(WHITESPACE)
        val out = ArrayList<QueryToken>(parts.size)
        for (raw in parts) {
            if (raw.isEmpty()) continue
            val slash = raw.indexOf('/')
            if (slash >= 0) {
                out += QueryToken(
                    raw = raw,
                    providerPart = raw.substring(0, slash).ifEmpty { null },
                    modelPart = raw.substring(slash + 1).ifEmpty { null },
                )
            } else {
                out += QueryToken(raw = raw, providerPart = null, modelPart = null)
            }
        }
        return out
    }

    data class QueryToken(
        val raw: String,
        val providerPart: String?,
        val modelPart: String?,
    )

    private fun scoreToken(entry: ModelPickerEntry, token: QueryToken): Int? {
        val providerPart = token.providerPart
        val modelPart = token.modelPart
        if (providerPart != null || modelPart != null) {
            if (providerPart != null) {
                val pScore = matchField(entry.providerIdLower, providerPart)
                    ?: matchField(entry.providerLabelLower, providerPart)
                    ?: return null
                if (modelPart.isNullOrEmpty()) return pScore
                val mScore = matchField(entry.modelIdLower, modelPart)
                    ?: matchField(entry.modelLabelLower, modelPart)
                    ?: return null
                return maxOf(pScore, mScore)
            }
            if (modelPart != null) {
                return matchField(entry.modelIdLower, modelPart)
                    ?: matchField(entry.modelLabelLower, modelPart)
            }
        }
        // Non-slash: haystack already covers provider id/label + model id/name.
        return matchField(entry.haystack, token.raw)
    }

    /**
     * Scores: exact 100, prefix 60, word-boundary 40, substring 20.
     * Fuzzy subsequence scoring removed — too expensive on multi-k catalogs.
     */
    private fun matchField(field: String, token: String): Int? {
        if (token.isEmpty()) return 100
        if (field == token) return 100
        if (field.startsWith(token)) return 60
        var i = field.indexOf(token)
        while (i >= 0) {
            if (i == 0 || !field[i - 1].isLetterOrDigit()) return 40
            i = field.indexOf(token, i + 1)
        }
        if (field.contains(token)) return 20
        return null
    }

    private fun matchesFollowDefault(tokens: List<QueryToken>): Boolean {
        if (tokens.isEmpty()) return true
        val labels = listOf(
            "follow",
            "default",
            VibeflyBundle.message("settings.commitMessage.model.followDefault").lowercase(Locale.ROOT),
            VibeflyBundle.message("settings.model.picker.followDefault").lowercase(Locale.ROOT),
        )
        return tokens.all { t ->
            val raw = t.raw
            labels.any { label -> label.contains(raw) }
        }
    }

    private fun followDefaultEntry(): ModelPickerEntry =
        ModelPickerEntry(
            spec = "",
            providerId = "",
            providerLabel = "",
            modelId = "",
            modelLabel = VibeflyBundle.message("settings.model.picker.followDefault"),
            providerRank = Int.MIN_VALUE,
            modelPriority = Int.MIN_VALUE,
            badges = emptyList(),
            haystack = "follow default",
            providerIdLower = "",
            providerLabelLower = "",
            modelIdLower = "",
            modelLabelLower = "follow default model",
        )

    private fun appendTier(
        rows: MutableList<ModelPickerRow>,
        entries: List<ModelPickerEntry>,
        tier: ModelPickerTier,
        groupLabel: String,
        preserveOrder: Boolean,
    ) {
        if (entries.isEmpty()) return
        // preserveOrder always true for pin/recent currently; keep param for clarity.
        @Suppress("UNUSED_VARIABLE")
        val ordered = if (preserveOrder) entries else entries
        var first = true
        for (e in ordered) {
            rows += ModelPickerRow(
                entry = e,
                tier = tier,
                groupLabel = groupLabel,
                isFirstInGroup = first,
            )
            first = false
        }
    }

    private fun entryFromBundled(
        providerId: String,
        providerLabel: String,
        providerRank: Int,
        m: BundledModelCatalog.Model,
    ): ModelPickerEntry {
        val name = m.name.ifBlank { m.id }
        val badges = buildBadges(
            contextWindow = m.contextWindow,
            inputCost = m.inputCostPerMTok,
            outputCost = m.outputCostPerMTok,
            reasoning = m.reasoning,
            vision = m.vision,
            toolsUnsupported = m.toolsUnsupported,
        )
        val providerIdLower = providerId.lowercase(Locale.ROOT)
        val providerLabelLower = providerLabel.lowercase(Locale.ROOT)
        val modelIdLower = m.id.lowercase(Locale.ROOT)
        val modelLabelLower = name.lowercase(Locale.ROOT)
        return ModelPickerEntry(
            spec = "$providerId/${m.id}",
            providerId = providerId,
            providerLabel = providerLabel,
            modelId = m.id,
            modelLabel = name,
            providerRank = providerRank,
            modelPriority = m.priority ?: Int.MAX_VALUE,
            badges = badges,
            haystack = "$providerIdLower $providerLabelLower $modelIdLower $modelLabelLower",
            providerIdLower = providerIdLower,
            providerLabelLower = providerLabelLower,
            modelIdLower = modelIdLower,
            modelLabelLower = modelLabelLower,
        )
    }

    private fun entryFromCustom(
        providerId: String,
        providerLabel: String,
        providerRank: Int,
        m: ProviderModelSnapshot,
    ): ModelPickerEntry {
        val name = m.name?.takeIf { it.isNotBlank() } ?: m.id
        val providerIdLower = providerId.lowercase(Locale.ROOT)
        val providerLabelLower = providerLabel.lowercase(Locale.ROOT)
        val modelIdLower = m.id.lowercase(Locale.ROOT)
        val modelLabelLower = name.lowercase(Locale.ROOT)
        return ModelPickerEntry(
            spec = "$providerId/${m.id}",
            providerId = providerId,
            providerLabel = providerLabel,
            modelId = m.id,
            modelLabel = name,
            providerRank = providerRank,
            modelPriority = Int.MAX_VALUE,
            badges = emptyList(),
            haystack = "$providerIdLower $providerLabelLower $modelIdLower $modelLabelLower",
            providerIdLower = providerIdLower,
            providerLabelLower = providerLabelLower,
            modelIdLower = modelIdLower,
            modelLabelLower = modelLabelLower,
        )
    }

    private fun formatCostNumber(value: Double): String {
        if (value == value.toLong().toDouble()) return value.toLong().toString()
        return trimTrailingZeros(String.format(Locale.US, "%.2f", value))
    }

    private fun trimTrailingZeros(s: String): String {
        if (!s.contains('.')) return s
        return s.trimEnd('0').trimEnd('.')
    }
}
