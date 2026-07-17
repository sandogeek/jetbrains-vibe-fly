package com.github.sandogeek.simplerpc.codegen

/**
 * Options for [TypeScriptGenerator].
 *
 * @param runtimeModule ESM module specifier imported by generated code for peer helpers.
 */
data class TypeScriptGenerationOptions(
    val runtimeModule: String = "@sandogeek/simple-rpc",
)
