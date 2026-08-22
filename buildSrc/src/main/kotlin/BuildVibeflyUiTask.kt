import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations
import java.io.File
import javax.inject.Inject

/**
 * Runs `pnpm run build` in packages/vibefly-ui (Vite → vibefly-jcef resources/web).
 * Resolves `node` / `pnpm` via property, PATH, and common install locations.
 */
abstract class BuildVibeflyUiTask @Inject constructor(
    private val execOperations: ExecOperations,
) : DefaultTask() {

    /** Command name or absolute path. Default: `node`. */
    @get:Input
    abstract val nodeCommand: Property<String>

    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val workingDirectory: DirectoryProperty

    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val uiSourceDir: DirectoryProperty

    @get:InputFile
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val packageJson: RegularFileProperty

    @get:InputFile
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val viteConfig: RegularFileProperty

    @get:InputFile
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val indexHtml: RegularFileProperty

    /** Generated provider catalog — fingerprint so catalog-only changes rebuild web resources. */
    @get:InputFile
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val providerCatalog: RegularFileProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun build() {
        val workDir = workingDirectory.get().asFile
        val nodeModules = File(workDir, "node_modules")
        if (!nodeModules.isDirectory) {
            logger.warn(
                "Skip vibefly-ui build: missing node_modules at {}. Run: pnpm install",
                nodeModules,
            )
            return
        }

        val node = resolveNodeExecutable(nodeCommand.get())
            ?: throw GradleException(
                "Cannot find 'node'. Install Node.js or set -Pvibefly.node=/path/to/node. " +
                    "IDE-launched Gradle often misses Homebrew/nvm PATH.",
            )
        val pnpm = resolvePnpmExecutable(node)
            ?: throw GradleException(
                "Cannot find 'pnpm'. Enable Corepack (`corepack enable`) or install pnpm, " +
                    "or set -Pvibefly.node so pnpm can be resolved next to node.",
            )

        logger.info("Building vibefly-ui with {} ({})", node, pnpm)
        execOperations.exec {
            workingDir(workDir)
            commandLine(pnpm, "run", "build")
            environment("PATH", pathWithNodeFirst(node))
            environment("CI", "true")
        }
    }

    companion object {
        fun resolveNodeExecutable(configured: String): String? {
            val candidate = configured.trim()
            if (candidate.isEmpty()) return null

            // Absolute / relative path
            if (candidate.contains(File.separator) || candidate.startsWith("~")) {
                val file = expandHome(candidate)
                return file.takeIf { it.isFile && it.canExecute() }?.absolutePath
            }

            // Bare command: search known locations then PATH
            if (candidate == "node" || candidate == "node.exe") {
                for (path in candidateNodePaths()) {
                    val file = File(path)
                    if (file.isFile && file.canExecute()) return file.absolutePath
                }
            }

            return findOnPath(candidate)
        }

        /** Prefer pnpm next to [nodeExecutable], then PATH (Corepack / standalone install). */
        fun resolvePnpmExecutable(nodeExecutable: String): String? {
            val nodeFile = File(nodeExecutable)
            val binDir = nodeFile.parentFile ?: return findOnPath(pnpmBinaryName())
            for (name in pnpmBinaryNames()) {
                val file = File(binDir, name)
                if (file.exists() && (file.canExecute() || file.isFile)) {
                    return file.absolutePath
                }
            }
            return findOnPath(pnpmBinaryName())
        }

        /** Prepend node's bin dir so child pnpm/scripts resolve `node` when IDE PATH is minimal. */
        fun pathWithNodeFirst(nodeExecutable: String, basePath: String? = System.getenv("PATH")): String {
            val nodeDir = File(nodeExecutable).parent ?: return basePath.orEmpty()
            val existing = basePath.orEmpty()
            return if (existing.isEmpty()) nodeDir else "$nodeDir${File.pathSeparator}$existing"
        }

        private fun pnpmBinaryName(): String =
            if (isWindows()) "pnpm.cmd" else "pnpm"

        private fun pnpmBinaryNames(): List<String> =
            if (isWindows()) listOf("pnpm.cmd", "pnpm.exe", "pnpm") else listOf("pnpm")

        private fun nodeBinaryName(): String =
            if (isWindows()) "node.exe" else "node"

        private fun isWindows(): Boolean =
            System.getProperty("os.name").orEmpty().lowercase().contains("windows")

        private fun candidateNodePaths(): List<String> {
            val home = System.getProperty("user.home").orEmpty()
            val node = nodeBinaryName()
            return buildList {
                if (home.isNotEmpty()) {
                    add("$home/.nvm/current/bin/$node")
                    // nvm often has no "current" symlink — pick newest installed version
                    addAll(nvmVersionNodePaths(home, node))
                    add("$home/.fnm/current/bin/$node")
                    add("$home/.local/share/fnm/current/bin/$node")
                    add("$home/.volta/bin/$node")
                    add("$home/.asdf/shims/$node")
                }
                add("/opt/homebrew/bin/$node")
                add("/usr/local/bin/$node")
                add("/usr/bin/$node")
            }
        }

        private fun nvmVersionNodePaths(home: String, node: String): List<String> {
            val versionsDir = File(home, ".nvm/versions/node")
            if (!versionsDir.isDirectory) return emptyList()
            return versionsDir.listFiles()
                ?.filter { it.isDirectory }
                ?.sortedByDescending { it.name }
                ?.map { File(it, "bin/$node").absolutePath }
                .orEmpty()
        }

        private fun findOnPath(command: String): String? {
            val path = System.getenv("PATH").orEmpty()
            if (path.isEmpty()) return null
            for (dir in path.split(File.pathSeparatorChar)) {
                if (dir.isEmpty()) continue
                val file = File(dir, command)
                if (file.isFile && file.canExecute()) return file.absolutePath
            }
            return null
        }

        private fun expandHome(path: String): File {
            if (path.startsWith("~/") || path == "~") {
                val home = System.getProperty("user.home")
                return File(path.replaceFirst("~", home))
            }
            return File(path)
        }
    }
}
