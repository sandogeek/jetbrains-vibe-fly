package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.codegen.TypeScriptGenerationOptions
import com.github.sandogeek.simplerpc.codegen.TypeScriptGenerator
import java.nio.file.Path

/**
 * CLI: generate TypeScript Host2Agent contracts for vibefly-agent.
 *
 * Usage: `GenerateAgentControlRpc <output-path>`
 */
fun main(args: Array<String>) {
    require(args.isNotEmpty()) { "Usage: GenerateAgentControlRpc <output-path>" }
    val output = Path.of(args[0])
    TypeScriptGenerator.generateTo(
        output,
        listOf(Host2Agent::class.java),
        TypeScriptGenerationOptions(runtimeModule = "@sandogeek/simple-rpc"),
    )
    println("Wrote $output")
}
