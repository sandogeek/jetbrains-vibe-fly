import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import javax.inject.Inject

/**
 * Builds packages/vibefly-agent and stages a production runtime tree for the plugin zip:
 * `dist/`, rewritten local file deps, `pnpm install --prod`, then prune of optional/heavy
 * packages that are not required for agent boot (onnx/sherpa/react TUI/puppeteer, etc.).
 *
 * Output layout (plugin root):
 * ```
 * agent/
 *   package.json
 *   dist/main.js
 *   node_modules/...
 *   simple-rpc-ts/
 *   simple-rpc-node/
 *   uiagent-shared/
 * ```
 *
 * Override node: `-Pvibefly.node=/path/to/node`
 */
abstract class BuildVibeflyAgentTask @Inject constructor(
    private val execOperations: ExecOperations,
) : DefaultTask() {

    @get:Input
    abstract val nodeCommand: Property<String>

    /** Package root used for exec/cwd — not fingerprinted (node_modules is huge). */
    @get:Internal
    abstract val agentRootDir: DirectoryProperty

    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val agentSourceDir: DirectoryProperty

    @get:InputFile
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val agentPackageJson: RegularFileProperty

    @get:InputFile
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val agentTsconfig: RegularFileProperty

    @get:Internal
    abstract val simpleRpcTsDir: DirectoryProperty

    @get:Internal
    abstract val simpleRpcNodeDir: DirectoryProperty

    @get:Internal
    abstract val uiagentSharedDir: DirectoryProperty

    /**
     * Fingerprint monorepo package.json / lock / local package sources so upgrades rebuild the stage.
     * Intentionally narrow — not the whole node_modules tree.
     */
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val dependencyMarkers: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun build() {
        val node = BuildVibeflyUiTask.resolveNodeExecutable(nodeCommand.get())
            ?: throw GradleException(
                "Cannot find 'node'. Install Node.js or set -Pvibefly.node=/path/to/node. " +
                    "IDE-launched Gradle often misses Homebrew/nvm PATH.",
            )
        val pnpm = BuildVibeflyUiTask.resolvePnpmExecutable(node)
            ?: throw GradleException(
                "Cannot find 'pnpm'. Enable Corepack (`corepack enable`) or install pnpm, " +
                    "or set -Pvibefly.node so pnpm can be resolved next to node.",
            )

        val agentRoot = agentRootDir.get().asFile
        ensureLocalPackageBuilt(node, pnpm, simpleRpcTsDir.get().asFile)
        ensureLocalPackageBuilt(node, pnpm, simpleRpcNodeDir.get().asFile)
        ensureLocalPackageBuilt(node, pnpm, uiagentSharedDir.get().asFile)
        ensureAgentDist(node, pnpm, agentRoot)

        val out = outputDir.get().asFile
        if (out.exists()) {
            out.deleteRecursively()
        }
        if (!out.mkdirs()) {
            throw GradleException("Cannot create agent bundle output: $out")
        }

        val stagedSimpleRpcTs = File(out, "simple-rpc-ts")
        val stagedSimpleRpcNode = File(out, "simple-rpc-node")
        val stagedShared = File(out, "uiagent-shared")
        copyRuntimePackage(simpleRpcTsDir.get().asFile, stagedSimpleRpcTs)
        copyRuntimePackage(simpleRpcNodeDir.get().asFile, stagedSimpleRpcNode)
        copyRuntimePackage(uiagentSharedDir.get().asFile, stagedShared)

        // Nested file: deps must resolve inside the staged tree.
        rewritePackageJsonFileDeps(
            File(stagedSimpleRpcNode, "package.json"),
            mapOf("@sandogeek/simple-rpc" to "file:../simple-rpc-ts"),
        )
        rewritePackageJsonFileDeps(
            File(stagedShared, "package.json"),
            mapOf("@sandogeek/simple-rpc" to "file:../simple-rpc-ts"),
        )

        val distSrc = File(agentRoot, "dist")
        if (!File(distSrc, "main.js").isFile) {
            throw GradleException("Agent build missing ${File(distSrc, "main.js")}")
        }
        copyDirectory(distSrc, File(out, "dist"), skipTests = true, runtimeJsOnly = true)

        val rootPackage = File(out, "package.json")
        Files.copy(
            agentPackageJson.get().asFile.toPath(),
            rootPackage.toPath(),
            StandardCopyOption.REPLACE_EXISTING,
        )
        rewritePackageJsonFileDeps(
            rootPackage,
            mapOf(
                "@sandogeek/simple-rpc" to "file:./simple-rpc-ts",
                "@sandogeek/simple-rpc-node" to "file:./simple-rpc-node",
                "@vibefly/uiagent-shared" to "file:./uiagent-shared",
            ),
            dropDevDependencies = true,
        )

        // Hoisted layout so pruneHeavyOptionalRuntime can drop top-level optional heavies
        // the same way the previous npm staging did.
        // pnpm 11 only reads auth/registry from .npmrc; nodeLinker lives in
        // pnpm-workspace.yaml (or --config). A staged .npmrc is ignored.
        val stagedWorkspace = File(out, "pnpm-workspace.yaml")
        stagedWorkspace.writeText("nodeLinker: hoisted\n")

        logger.lifecycle("Installing production vibefly-agent runtime with {} ({})", node, pnpm)
        // Keep optional pi dependencies during install; heavy unused optionals are pruned below.
        // --ignore-workspace: staged tree lives under the monorepo; do not hoist into root workspace.
        pnpmExec(
            out,
            pnpm,
            node,
            "install",
            "--prod",
            "--ignore-scripts",
            "--ignore-workspace",
            "--config.nodeLinker=hoisted",
        )
        stagedWorkspace.delete()

        val nodeModules = File(out, "node_modules")
        pruneHeavyOptionalRuntime(nodeModules)
        // prepareSandbox follows symbolic links and fails if prune left dangling
        // pnpm links (e.g. protobufjs → @types/node after @types was dropped).
        removeDanglingSymlinks(out)
        val strippedBytes = stripNonRuntimeArtifacts(out)
        val sizeBytes = directorySize(out)
        logger.lifecycle(
            "Pruned agent runtime: stripped {} non-runtime files; staged size {}",
            formatBytes(strippedBytes),
            formatBytes(sizeBytes),
        )

        val entry = File(out, "dist/main.js")
        if (!entry.isFile) {
            throw GradleException("Agent bundle missing entry: $entry")
        }
        logger.lifecycle("Bundled vibefly-agent → {}", out)
    }

    private fun ensureLocalPackageBuilt(node: String, pnpm: String, packageDir: File) {
        val packageJson = File(packageDir, "package.json")
        if (!packageJson.isFile) {
            throw GradleException("Missing package.json: $packageJson")
        }
        val distIndex = File(packageDir, "dist/index.js")
        val nodeModules = File(packageDir, "node_modules")
        if (!nodeModules.isDirectory) {
            logger.lifecycle("pnpm install (workspace) for {}", packageDir)
            pnpmInstallWorkspace(packageDir, pnpm, node)
        }
        if (!distIndex.isFile) {
            logger.lifecycle("Building local package {}", packageDir.name)
            pnpmExec(packageDir, pnpm, node, "run", "build")
        }
        if (!distIndex.isFile) {
            throw GradleException("Local package build missing $distIndex")
        }
    }

    private fun ensureAgentDist(node: String, pnpm: String, agentRoot: File) {
        val nodeModules = File(agentRoot, "node_modules")
        if (!nodeModules.isDirectory) {
            logger.lifecycle("pnpm install (workspace) for {}", agentRoot)
            pnpmInstallWorkspace(agentRoot, pnpm, node)
        }
        logger.lifecycle("Building vibefly-agent TypeScript")
        pnpmExec(agentRoot, pnpm, node, "run", "build")
    }

    /** Install from monorepo root when possible so workspace:* links resolve. */
    private fun pnpmInstallWorkspace(packageDir: File, pnpm: String, node: String) {
        val workspaceRoot = findWorkspaceRoot(packageDir) ?: packageDir
        pnpmExec(workspaceRoot, pnpm, node, "install")
    }

    private fun findWorkspaceRoot(start: File): File? {
        var dir: File? = start
        while (dir != null) {
            if (File(dir, "pnpm-workspace.yaml").isFile) {
                return dir
            }
            dir = dir.parentFile
        }
        return null
    }

    private fun pnpmExec(workDir: File, pnpm: String, node: String, vararg args: String) {
        execOperations.exec {
            workingDir(workDir)
            commandLine(listOf(pnpm) + args)
            environment("PATH", BuildVibeflyUiTask.pathWithNodeFirst(node))
            environment("CI", "true")
        }
    }

    private fun copyRuntimePackage(from: File, to: File) {
        if (!from.isDirectory) {
            throw GradleException("Missing package directory: $from")
        }
        to.mkdirs()
        val packageJson = File(from, "package.json")
        if (!packageJson.isFile) {
            throw GradleException("Missing package.json: $packageJson")
        }
        Files.copy(
            packageJson.toPath(),
            File(to, "package.json").toPath(),
            StandardCopyOption.REPLACE_EXISTING,
        )

        // Runtime packages must expose compiled JavaScript to the plain Node process.
        val dist = File(from, "dist")
        if (dist.isDirectory) {
            copyDirectory(dist, File(to, "dist"), runtimeJsOnly = true)
        }
        if (!dist.isDirectory) {
            throw GradleException("Runtime package missing compiled dist: $from")
        }
    }

    private fun copyDirectory(
        from: File,
        to: File,
        skipTests: Boolean = false,
        runtimeJsOnly: Boolean = false,
    ) {
        if (to.exists()) {
            to.deleteRecursively()
        }
        from.walkTopDown().forEach { src ->
            val rel = src.relativeTo(from)
            if (skipTests && isTestArtifact(rel.path)) {
                return@forEach
            }
            if (runtimeJsOnly && src.isFile && isNonRuntimeDistFile(src.name)) {
                return@forEach
            }
            val dest = File(to, rel.path)
            if (src.isDirectory) {
                dest.mkdirs()
            } else {
                dest.parentFile?.mkdirs()
                Files.copy(src.toPath(), dest.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
        }
    }

    private fun isTestArtifact(relativePath: String): Boolean {
        val name = relativePath.substringAfterLast('/')
        return name.contains(".test.") || name.endsWith(".test.js") || name.endsWith(".test.d.ts")
    }

    private fun isNonRuntimeDistFile(name: String): Boolean {
        return name.endsWith(".map") ||
            name.endsWith(".d.ts") ||
            name.endsWith(".d.mts") ||
            name.endsWith(".d.cts")
    }

    private fun rewritePackageJsonFileDeps(
        packageJson: File,
        rewrites: Map<String, String>,
        dropDevDependencies: Boolean = false,
    ) {
        if (!packageJson.isFile) {
            throw GradleException("Missing package.json: $packageJson")
        }
        val text = packageJson.readText()
        // Lightweight rewrite without pulling a JSON library into buildSrc.
        // Preserve formatting-ish by only replacing known file:/workspace: dependency strings and
        // optionally stripping the "devDependencies" object.
        var next = text
        for ((name, target) in rewrites) {
            val patterns = listOf(
                """"$name"\s*:\s*"file:[^"]*"""" to """"$name": "$target"""",
                """"$name"\s*:\s*"workspace:[^"]*"""" to """"$name": "$target"""",
                """"$name"\s*:\s*"[^"]*"""" to """"$name": "$target"""",
            )
            var replaced = false
            for ((regex, replacement) in patterns) {
                val re = Regex(regex)
                if (re.containsMatchIn(next)) {
                    next = re.replace(next, replacement)
                    replaced = true
                    break
                }
            }
            if (!replaced && next.contains("\"dependencies\"")) {
                // Insert into dependencies block if key missing entirely.
                next = next.replaceFirst(
                    Regex("""("dependencies"\s*:\s*\{)"""),
                    """$1\n    "$name": "$target",""",
                )
            }
        }
        if (dropDevDependencies) {
            next = next.replace(
                Regex(
                    """,?\s*"devDependencies"\s*:\s*\{(?:[^{}]|\{[^{}]*\})*\}""",
                    RegexOption.DOT_MATCHES_ALL,
                ),
                "",
            )
        }
        // Staged agent is a standalone tree; strip monorepo lifecycle hooks that call pnpm -C.
        // Consume an optional trailing comma so first-entry removals do not leave `{,`.
        next = next.replace(
            Regex(
                """,?\s*"pre(build|typecheck|test|start|start:dist|publishOnly)"\s*:\s*"[^"]*"\s*,?""",
            ),
            "",
        )
        // Drop trailing/leading commas left by script/devDependency stripping (strict JSON).
        next = next.replace(Regex(""",(\s*[}\]])"""), "$1")
        next = next.replace(Regex("""([{\[])(\s*),"""), "$1$2")
        packageJson.writeText(next)
    }

    private fun pruneHeavyOptionalRuntime(nodeModules: File) {
        if (!nodeModules.isDirectory) return
        // Keep @opentelemetry/* — pi-coding-agent imports it at boot.
        // Keep provider SDKs (anthropic/openai/mistral/google/aws) — pi-ai static-imports them.
        val exact = listOf(
            "onnxruntime-node",
            "onnxruntime-web",
            "onnxruntime-common",
            "sherpa-onnx-node",
            "@huggingface/transformers",
            "lucide-react",
            "react",
            "react-dom",
            "chart.js",
            "react-chartjs-2",
            "date-fns",
            "moment",
            "puppeteer-core",
            "chromium-bidi",
            "mupdf",
            "devtools-protocol",
        )
        for (name in exact) {
            deletePackageEverywhere(nodeModules, name)
        }
        deletePackageEverywhere(nodeModules, "@puppeteer")
        deletePackageEverywhere(nodeModules, "@img")
        deletePackageEverywhere(nodeModules, "@types")
        nodeModules.walkTopDown()
            .maxDepth(4)
            .filter { it.isDirectory && it.name.startsWith("sherpa-onnx-") }
            .toList()
            .forEach { it.deleteRecursively() }
        pruneForeignOptionalNatives(nodeModules)
        // Gradle Sync cannot follow dangling bin symlinks after prune; agent runs via `node dist/main.js`.
        File(nodeModules, ".bin").takeIf { it.exists() }?.deleteRecursively()
    }

    /**
     * pnpm prune leaves nested links whose targets were deleted (types, optional natives).
     * Gradle Copy / prepareSandbox follows symbolic links and fails on dangling ones.
     */
    private fun removeDanglingSymlinks(root: File) {
        if (!root.isDirectory) return
        val dangling = ArrayDeque<java.nio.file.Path>()
        Files.walk(root.toPath()).use { stream ->
            stream.filter { Files.isSymbolicLink(it) && !Files.exists(it) }
                .forEach { dangling.add(it) }
        }
        var removed = 0
        for (path in dangling) {
            if (Files.deleteIfExists(path)) {
                removed++
            }
        }
        if (removed > 0) {
            logger.lifecycle("Removed {} dangling symlinks after prune", removed)
        }
    }

    /**
     * Drop optional native packages that cannot run on this build host.
     * Note: Marketplace zip is currently host-platform for optional natives (pnpm only installs
     * matching optionalDependencies). This only removes clearly foreign platform folders if present.
     */
    private fun pruneForeignOptionalNatives(nodeModules: File) {
        val os = System.getProperty("os.name").lowercase()
        val arch = System.getProperty("os.arch").lowercase()
        val keepTokens = mutableListOf<String>()
        when {
            os.contains("mac") || os.contains("darwin") -> {
                keepTokens += "darwin"
                keepTokens += if (arch.contains("aarch64") || arch.contains("arm64")) "arm64" else "x64"
            }
            os.contains("win") -> {
                keepTokens += "win32"
                keepTokens += "windows"
                keepTokens += "x64"
            }
            else -> {
                keepTokens += "linux"
                keepTokens += if (arch.contains("aarch64") || arch.contains("arm64")) "arm64" else "x64"
            }
        }
        val platformMarkers = listOf(
            "darwin", "linux", "win32", "windows", "android", "freebsd",
            "arm64", "aarch64", "x64", "x86_64", "ia32", "armv7", "universal",
        )
        nodeModules.walkTopDown()
            .maxDepth(6)
            .filter { it.isDirectory }
            .filter { dir ->
                val n = dir.name.lowercase()
                platformMarkers.any { marker -> n.contains(marker) } &&
                    (n.contains("darwin") || n.contains("linux") || n.contains("win32") ||
                        n.contains("windows") || n.contains("android"))
            }
            .toList()
            .forEach { dir ->
                val n = dir.name.lowercase()
                val isCurrentOs = when {
                    os.contains("mac") || os.contains("darwin") -> n.contains("darwin")
                    os.contains("win") -> n.contains("win32") || n.contains("windows")
                    else -> n.contains("linux")
                }
                if (!isCurrentOs) {
                    dir.deleteRecursively()
                    return@forEach
                }
                // Prefer arch-specific over universal when both exist for the same package family.
                if (n.contains("universal") && keepTokens.any { it == "arm64" || it == "x64" }) {
                    val siblingArch = dir.parentFile?.listFiles()?.any { sibling ->
                        sibling.isDirectory &&
                            sibling != dir &&
                            sibling.name.lowercase().let { sn ->
                                keepTokens.any { token -> sn.contains(token) } &&
                                    !sn.contains("universal")
                            }
                    } == true
                    if (siblingArch) {
                        dir.deleteRecursively()
                    }
                }
            }
    }

    private fun deletePackageEverywhere(nodeModules: File, packageName: String) {
        if (packageName.startsWith("@") && !packageName.contains("/")) {
            // Scoped root such as @types / @puppeteer
            File(nodeModules, packageName).takeIf { it.exists() }?.deleteRecursively()
            // pnpm virtual store uses both `types+…` and `@types+…` folder names.
            val scope = packageName.removePrefix("@")
            File(nodeModules, ".pnpm").listFiles()
                ?.filter {
                    it.isDirectory &&
                        (it.name.startsWith("$scope+") || it.name.startsWith("$packageName+"))
                }
                ?.forEach { it.deleteRecursively() }
            return
        }
        if (packageName.startsWith("@")) {
            val slash = packageName.indexOf('/')
            val scope = packageName.substring(0, slash)
            val name = packageName.substring(slash + 1)
            File(nodeModules, "$scope/$name").takeIf { it.exists() }?.deleteRecursively()
            // pnpm: `scope+name@version` or `@scope+name@version`
            val bare = "${scope.removePrefix("@")}+$name@"
            val atPrefixed = "$scope+$name@"
            File(nodeModules, ".pnpm").listFiles()
                ?.filter {
                    it.isDirectory &&
                        (it.name.startsWith(bare) || it.name.startsWith(atPrefixed))
                }
                ?.forEach { it.deleteRecursively() }
            return
        }
        File(nodeModules, packageName).takeIf { it.exists() }?.deleteRecursively()
        File(nodeModules, ".pnpm").listFiles()
            ?.filter { it.isDirectory && it.name.startsWith("$packageName@") }
            ?.forEach { it.deleteRecursively() }
        // Nested copies under other packages' node_modules.
        nodeModules.walkTopDown()
            .maxDepth(8)
            .filter { it.isDirectory && it.name == packageName && it.parentFile?.name == "node_modules" }
            .toList()
            .forEach { it.deleteRecursively() }
    }

    /**
     * Remove type defs, source maps, docs, tests, and published TS sources from the staged tree.
     * Returns total bytes removed.
     */
    private fun stripNonRuntimeArtifacts(root: File): Long {
        var removed = 0L
        // Package-root marketing/demo trees. Nested runtime trees like yaml's `dist/doc/` are kept
        // because they do not sit next to a package.json.
        val packageRootJunkDirs = setOf("docs", "doc", "example", "examples", "website", "demo", "demos")
        val skipDirNames = setOf(
            "test", "tests", "testing", "__tests__",
            ".github", "coverage", "benchmark", "benchmarks", "fixtures",
        )
        val skipFileNames = setOf(
            "readme", "readme.md", "readme.markdown", "changelog", "changelog.md",
            "history.md", "license", "license.md", "license.txt", "licence", "licence.md",
            "contributing.md", "security.md", "code_of_conduct.md", "authors", "authors.md",
        )
        val files = root.walkTopDown().toList()
        // Delete known non-runtime directories first (deepest first).
        files
            .asReversed()
            .filter { it.isDirectory }
            .forEach { dir ->
                val rel = dir.relativeTo(root).path.replace('\\', '/')
                if (!rel.contains("node_modules") && !rel.contains(".pnpm")) return@forEach
                val lower = dir.name.lowercase()
                val packageRootJunk =
                    packageRootJunkDirs.contains(lower) &&
                        File(dir.parentFile, "package.json").isFile
                val namedJunk = skipDirNames.contains(lower)
                if (!packageRootJunk && !namedJunk) return@forEach
                // For test/coverage trees, keep if they only exist as runtime (rare).
                if (namedJunk && !packageRootJunk &&
                    dir.walkTopDown().any { f ->
                        f.isFile && (
                            f.name.endsWith(".node") || f.name.endsWith(".wasm")
                            )
                    }
                ) {
                    return@forEach
                }
                removed += directorySize(dir)
                dir.deleteRecursively()
            }
        root.walkTopDown()
            .filter { it.isFile }
            .toList()
            .forEach { file ->
                val name = file.name
                val lower = name.lowercase()
                val rel = file.relativeTo(root).path.replace('\\', '/')
                val underNodeModules = rel.contains("node_modules") || rel.contains(".pnpm")
                val drop = when {
                    name.endsWith(".map") -> true
                    name.endsWith(".d.ts") || name.endsWith(".d.mts") || name.endsWith(".d.cts") -> true
                    // Published package `src/**/*.ts` is not needed when compiled JS is present.
                    // Never strip under package `dist/` (some ship .ts helpers) or yaml-like runtime trees.
                    name.endsWith(".ts") && underNodeModules -> {
                        val parent = file.parentFile?.name?.lowercase()
                        parent != "dist" && (rel.contains("/src/") || rel.contains("\\src\\"))
                    }
                    lower.endsWith(".md") || lower.endsWith(".markdown") -> true
                    skipFileNames.contains(lower) -> true
                    name == "tsconfig.json" || (name.startsWith("tsconfig.") && name.endsWith(".json")) ->
                        underNodeModules
                    else -> false
                }
                if (drop) {
                    removed += file.length()
                    file.delete()
                }
            }
        // Drop empty directories left behind.
        root.walkBottomUp()
            .filter { it.isDirectory && it != root && it.listFiles()?.isEmpty() == true }
            .forEach { it.delete() }
        return removed
    }

    private fun directorySize(dir: File): Long {
        if (!dir.exists()) return 0L
        // Do not follow symlinks — pnpm hoists packages as links into `.pnpm`, and following
        // would double-count the same files.
        var total = 0L
        val stack = ArrayDeque<File>()
        stack.add(dir)
        while (stack.isNotEmpty()) {
            val current = stack.removeLast()
            val children = current.listFiles() ?: continue
            for (child in children) {
                val isLink = try {
                    Files.isSymbolicLink(child.toPath())
                } catch (_: Exception) {
                    false
                }
                if (isLink) continue
                if (child.isDirectory) {
                    stack.add(child)
                } else if (child.isFile) {
                    total += child.length()
                }
            }
        }
        return total
    }

    private fun formatBytes(bytes: Long): String {
        if (bytes < 1024) return "${bytes}B"
        val kib = bytes / 1024.0
        if (kib < 1024) return String.format("%.1fKB", kib)
        val mib = kib / 1024.0
        if (mib < 1024) return String.format("%.1fMB", mib)
        return String.format("%.2fGB", mib / 1024.0)
    }
}
