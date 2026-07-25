package com.github.sandogeek.vibefly.jcef.rpc

import kotlinx.serialization.Serializable

@Serializable
data class CatalogModel(
    val id: String,
    val name: String = "",
)

@Serializable
data class CatalogProvider(
    val id: String,
    val models: List<CatalogModel> = emptyList(),
)

@Serializable
data class ProviderCatalog(
    val providers: List<CatalogProvider> = emptyList(),
)
