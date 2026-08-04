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
        copyDirectory(distSrc, File(out, "dist"), skipTests = true)

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
        File(out, ".npmrc").writeText("node-linker=hoisted\n")

        logger.lifecycle("Installing production vibefly-agent runtime with {} ({})", node, pnpm)
        // Keep optional pi dependencies during install; heavy unused optionals are pruned below.
        pnpmExec(out, pnpm, node, "install", "--prod", "--ignore-scripts")

        pruneHeavyOptionalRuntime(File(out, "node_modules"))

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
            copyDirectory(dist, File(to, "dist"))
        }
        if (!dist.isDirectory) {
            throw GradleException("Runtime package missing compiled dist: $from")
        }
    }

    private fun copyDirectory(from: File, to: File, skipTests: Boolean = false) {
        if (to.exists()) {
            to.deleteRecursively()
        }
        from.walkTopDown().forEach { src ->
            val rel = src.relativeTo(from)
            if (skipTests && isTestArtifact(rel.path)) {
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
        next = next.replace(
            Regex(
                """,?\s*"pre(build|typecheck|test|start|start:dist|publishOnly)"\s*:\s*"[^"]*"""",
            ),
            "",
        )
        // Drop trailing commas left by script/devDependency stripping (strict JSON).
        next = next.replace(Regex(""",(\s*[}\]])"""), "$1")
        packageJson.writeText(next)
    }

    private fun pruneHeavyOptionalRuntime(nodeModules: File) {
        if (!nodeModules.isDirectory) return
        // Keep @opentelemetry/* — pi-coding-agent imports it at boot.
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
            File(nodeModules, name).takeIf { it.exists() }?.deleteRecursively()
        }
        File(nodeModules, "@puppeteer").takeIf { it.exists() }?.deleteRecursively()
        File(nodeModules, "@img").takeIf { it.exists() }?.deleteRecursively()
        nodeModules.listFiles()
            ?.filter { it.name.startsWith("sherpa-onnx-") }
            ?.forEach { it.deleteRecursively() }
        // Gradle Sync cannot follow dangling bin symlinks after prune; agent runs via `node dist/main.js`.
        File(nodeModules, ".bin").takeIf { it.exists() }?.deleteRecursively()
    }
}
