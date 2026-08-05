package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.codegen.TypeScriptGenerationOptions
import com.github.sandogeek.simplerpc.codegen.TypeScriptGenerator
import java.nio.file.Path

/**
 * CLI: generate TypeScript RPC contracts for vibefly-ui.
 *
 * Usage: `GenerateUiRpc <output-path>`
 */
fun main(args: Array<String>) {
    require(args.isNotEmpty()) { "Usage: GenerateUiRpc <output-path>" }
    val output = Path.of(args[0])
    TypeScriptGenerator.generateTo(
        output,
        listOf(
            Ui2Host::class.java,
            Ui2HostChat::class.java,
            Ui2HostSettings::class.java,
            Host2Ui::class.java,
            Host2UiChat::class.java,
            Host2UiSettings::class.java,
        ),
        TypeScriptGenerationOptions(runtimeModule = "@sandogeek/simple-rpc"),
    )
    println("Wrote $output")
}
