package com.github.sandogeek.simplerpc.codegen

import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue

/**
 * Runs the TypeScript package's local `tsc --noEmit` against generated source so
 * illegal identifiers, duplicate params, and type errors fail the generator tests.
 */
internal object TypeScriptCompileSupport {

    private val typeScriptRoot: Path by lazy { resolveTypeScriptRoot() }
    private val tsc: Path by lazy { typeScriptRoot.resolve("node_modules/typescript/bin/tsc") }

    fun assertCompiles(source: String, label: String = "generated") {
        assumeTrue(
            "TypeScript package not found (expected packages/vibefly-simplerpc/typeScript)",
            Files.isDirectory(typeScriptRoot),
        )
        assumeTrue(
            "tsc not found at $tsc — run npm install in packages/vibefly-simplerpc/typeScript",
            Files.isRegularFile(tsc),
        )

        val workDir = Files.createTempDirectory(typeScriptRoot, ".tsc-gen-")
        try {
            val compileSource = rewriteRuntimeImports(source)
            Files.writeString(workDir.resolve("generated.ts"), compileSource)

            val tsconfig = workDir.resolve("tsconfig.json")
            Files.writeString(
                tsconfig,
                """
                {
                  "compilerOptions": {
                    "target": "ES2022",
                    "module": "NodeNext",
                    "moduleResolution": "NodeNext",
                    "lib": ["ES2022", "DOM"],
                    "strict": true,
                    "skipLibCheck": true,
                    "noEmit": true,
                    "noUncheckedIndexedAccess": true,
                    "esModuleInterop": true,
                    "forceConsistentCasingInFileNames": true
                  },
                  "files": ["generated.ts"]
                }
                """.trimIndent() + "\n",
            )

            val process = ProcessBuilder(
                listOf(
                    resolveJsRuntime(),
                    tsc.toAbsolutePath().toString(),
                    "-p",
                    tsconfig.toAbsolutePath().toString(),
                ),
            )
                .directory(workDir.toFile())
                .redirectErrorStream(true)
                .start()

            val finished = process.waitFor(60, TimeUnit.SECONDS)
            val output = process.inputStream.bufferedReader().readText()
            assertTrue("tsc timed out for $label", finished)
            assertEquals(
                "tsc --noEmit failed for $label:\n$output\n--- source ---\n$compileSource",
                0,
                process.exitValue(),
            )
        } finally {
            deleteRecursively(workDir)
        }
    }

    private fun rewriteRuntimeImports(source: String): String {
        val runtime = "../src/index.js"
        return source
            .lines()
            .joinToString("\n") { line ->
                when {
                    line.startsWith("import type {") && line.contains("from \"") ->
                        line.replace(Regex("""from\s+"[^"]+""""), """from "$runtime"""")
                    line.startsWith("import {") && line.contains("from \"") ->
                        line.replace(Regex("""from\s+"[^"]+""""), """from "$runtime"""")
                    else -> line
                }
            } + if (source.endsWith("\n")) "\n" else ""
    }

    /** Resolve Node.js for running the local TypeScript compiler. */
    private fun resolveJsRuntime(): String {
        findExecutable("node")?.let { return it }
        error("node executable not found on PATH")
    }

    private fun findExecutable(name: String): String? {
        val fromPath = System.getenv("PATH")
            ?.split(System.getProperty("path.separator"))
            ?.map { Path.of(it, name) }
            ?.firstOrNull { Files.isExecutable(it) }
        if (fromPath != null) return fromPath.toString()
        return listOf(
            "/opt/homebrew/bin/$name",
            "/usr/local/bin/$name",
            "/usr/bin/$name",
        ).map { Path.of(it) }.firstOrNull { Files.isExecutable(it) }?.toString()
    }

    private fun resolveTypeScriptRoot(): Path {
        val cwd = Path.of("").toAbsolutePath()
        val candidates = listOf(
            cwd.resolve("typeScript"),
            cwd.resolve("packages/vibefly-simplerpc/typeScript"),
            cwd.parent?.resolve("packages/vibefly-simplerpc/typeScript"),
            cwd.parent?.resolve("typeScript"),
            cwd.resolve("vibefly-simplerpc/typeScript"),
        ).filterNotNull()
        return candidates.firstOrNull {
            Files.isDirectory(it) && Files.isRegularFile(it.resolve("package.json"))
        } ?: cwd.resolve("typeScript")
    }

    private fun deleteRecursively(path: Path) {
        if (!Files.exists(path)) return
        Files.walk(path)
            .sorted(Comparator.reverseOrder())
            .forEach { Files.deleteIfExists(it) }
    }
}
