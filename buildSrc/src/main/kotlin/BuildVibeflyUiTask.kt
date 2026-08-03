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
 * Runs `npm run build` in packages/vibefly-ui (Vite → vibefly-jcef resources/web).
 * Resolves `node` via property, PATH, and common install locations.
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
                "Skip vibefly-ui build: missing node_modules at {}. Run: (cd packages/vibefly-ui && npm install)",
                nodeModules,
            )
            return
        }

        val node = resolveNodeExecutable(nodeCommand.get())
            ?: throw GradleException(
                "Cannot find 'node'. Install Node.js or set -Pvibefly.node=/path/to/node. " +
                    "IDE-launched Gradle often misses Homebrew PATH (/opt/homebrew/bin).",
            )

        logger.info("Building vibefly-ui with {}", node)
        execOperations.exec {
            workingDir(workDir)
            commandLine("npm", "run", "build")
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
            if (candidate == "node") {
                for (path in candidateNodePaths()) {
                    val file = File(path)
                    if (file.isFile && file.canExecute()) return file.absolutePath
                }
            }

            return findOnPath(candidate)
        }

        private fun candidateNodePaths(): List<String> {
            val home = System.getProperty("user.home").orEmpty()
            return buildList {
                add("$home/.nvm/current/bin/node")
                add("/opt/homebrew/bin/node")
                add("/usr/local/bin/node")
                add("/usr/bin/node")
            }
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
