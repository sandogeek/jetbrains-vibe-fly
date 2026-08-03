import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations
import java.io.File
import javax.inject.Inject

/**
 * Runs packages/vibefly-agent `npm run export:catalog` to generate provider TS modules.
 *
 * When agent node_modules is missing, keeps the committed outputs so the plugin can still build.
 * Override node: -Pvibefly.node=/path/to/node
 *
 * Up-to-date inputs are intentional and narrow: only node path, package.json, export script,
 * and upstream package markers — not the whole agent tree (src/, package-lock.json, temps, etc.).
 */
abstract class ExportBundledCatalogTask @Inject constructor(
    private val execOperations: ExecOperations,
) : DefaultTask() {

    @get:Input
    abstract val nodeCommand: Property<String>

    /** Exec cwd only — not fingerprinted (avoids any agent-tree change busting up-to-date). */
    @get:Internal
    abstract val workingDirectory: DirectoryProperty

    @get:InputFile
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val packageJson: RegularFileProperty

    @get:InputFile
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val exportScript: RegularFileProperty

    /** Fingerprints for installed pi-catalog/pi-ai versions. */
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val upstreamPackageInputs: ConfigurableFileCollection

    @get:OutputFile
    abstract val uiOutputFile: RegularFileProperty

    @get:OutputFile
    abstract val agentOutputFile: RegularFileProperty

    @TaskAction
    fun export() {
        val workDir = workingDirectory.get().asFile
        val nodeModules = File(workDir, "node_modules")
        val outputs = listOf(uiOutputFile.get().asFile, agentOutputFile.get().asFile)
        if (!nodeModules.isDirectory) {
            if (outputs.all { it.isFile && it.length() > 0L }) {
                logger.warn(
                    "Skip provider catalog export: missing node_modules at {}. " +
                        "Using committed outputs. Run: (cd packages/vibefly-agent && npm install && npm run export:catalog)",
                    nodeModules,
                )
                return
            }
            throw GradleException(
                "Cannot export provider catalog: missing node_modules at $nodeModules " +
                    "and generated outputs are missing. Run: " +
                "(cd packages/vibefly-agent && npm install && npm run export:catalog)",
            )
        }

        val node = BuildVibeflyUiTask.resolveNodeExecutable(nodeCommand.get())
            ?: throw GradleException(
                "Cannot find 'node'. Install Node.js or set -Pvibefly.node=/path/to/node. " +
                    "IDE-launched Gradle often misses Homebrew/nvm PATH.",
            )
        val npm = BuildVibeflyUiTask.resolveNpmExecutable(node)
            ?: throw GradleException(
                "Cannot find 'npm' next to node at $node. Install Node.js with npm or set -Pvibefly.node.",
            )

        logger.lifecycle("Exporting bundled model catalog with {} ({})", node, npm)
        execOperations.exec {
            workingDir(workDir)
            commandLine(npm, "run", "export:catalog")
            environment("PATH", BuildVibeflyUiTask.pathWithNodeFirst(node))
        }
        val missing = outputs.filterNot { it.isFile && it.length() > 0L }
        if (missing.isNotEmpty()) {
            throw GradleException("export:catalog did not write ${missing.joinToString { it.path }}")
        }
    }
}
