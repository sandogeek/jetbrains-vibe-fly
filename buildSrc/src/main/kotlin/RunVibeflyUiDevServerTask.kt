import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations
import java.io.File
import javax.inject.Inject

/**
 * Runs `bun run dev` for packages/vibefly-ui in the foreground (IDE Run / Gradle console).
 * If the Vite port is already listening, exits successfully without starting another process.
 */
abstract class RunVibeflyUiDevServerTask @Inject constructor(
    private val execOperations: ExecOperations,
) : DefaultTask() {

    /** Command name or absolute path. Default: `bun`. */
    @get:Input
    abstract val bunCommand: Property<String>

    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val workingDirectory: DirectoryProperty

    /** e.g. `http://127.0.0.1:5173/` — used to detect an already-running server. */
    @get:Input
    abstract val devUrl: Property<String>

    @TaskAction
    fun runDev() {
        val url = devUrl.get().trim().ifEmpty { WaitVibeflyUiDevServerTask.DEFAULT_DEV_URL }
        val (host, port) = WaitVibeflyUiDevServerTask.parseHostPort(url)

        if (WaitVibeflyUiDevServerTask.isPortOpen(host, port)) {
            logger.lifecycle("vibefly-ui dev server already running at http://{}:{}/", host, port)
            return
        }

        val workDir = workingDirectory.get().asFile
        val nodeModules = File(workDir, "node_modules")
        if (!nodeModules.isDirectory) {
            throw GradleException(
                "Cannot start vibefly-ui dev server: missing node_modules at $nodeModules. " +
                    "Run: (cd packages/vibefly-ui && bun install)",
            )
        }

        val bun = BuildVibeflyUiTask.resolveBunExecutable(bunCommand.get())
            ?: throw GradleException(
                "Cannot find 'bun'. Install Bun (https://bun.sh) or set -Pvibefly.bun=/path/to/bun. " +
                    "IDE-launched Gradle often misses Homebrew PATH (/opt/homebrew/bin).",
            )

        logger.lifecycle("Starting vibefly-ui: {} run dev (cwd={})", bun, workDir)
        execOperations.exec {
            workingDir(workDir)
            commandLine(bun, "run", "dev")
        }
    }
}
