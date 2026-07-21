import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * Ensures Vite (`bun run dev`) is listening before [org.jetbrains.intellij.platform.gradle.tasks.RunIdeTask].
 * If the port is already open, does nothing; otherwise starts the server in the background and waits.
 */
abstract class EnsureVibeflyUiDevServerTask : DefaultTask() {

    /** When false, the task is a no-op (configuration-cache friendly alternative to onlyIf). */
    @get:Input
    abstract val uiDevEnabled: Property<Boolean>

    /** Command name or absolute path. Default: `bun`. */
    @get:Input
    abstract val bunCommand: Property<String>

    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val workingDirectory: DirectoryProperty

    /** e.g. `http://127.0.0.1:5173/` — host/port are parsed from this URL. */
    @get:Input
    abstract val devUrl: Property<String>

    @get:Input
    abstract val readyTimeoutSeconds: Property<Int>

    /** Log file for the background Vite process. */
    @get:Internal
    abstract val logFile: RegularFileProperty

    @TaskAction
    fun ensure() {
        if (!uiDevEnabled.get()) {
            logger.info("ensureVibeflyUiDevServer skipped (ui.dev not enabled)")
            return
        }

        val url = devUrl.get().trim().ifEmpty { DEFAULT_DEV_URL }
        val (host, port) = parseHostPort(url)

        if (isPortOpen(host, port)) {
            logger.lifecycle("vibefly-ui dev server already running at http://{}:{}/", host, port)
            return
        }

        val local = host == "127.0.0.1" || host.equals("localhost", ignoreCase = true)
        if (!local) {
            logger.warn(
                "vibefly-ui dev URL host is remote ({}:{}); not starting bun run dev. " +
                    "Start the server yourself if needed.",
                host,
                port,
            )
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

        val log = logFile.get().asFile
        log.parentFile?.mkdirs()

        logger.lifecycle(
            "Starting vibefly-ui dev server: {} run dev (cwd={}, log={})",
            bun,
            workDir,
            log,
        )

        val process = ProcessBuilder(bun, "run", "dev")
            .directory(workDir)
            .redirectOutput(ProcessBuilder.Redirect.appendTo(log))
            .redirectError(ProcessBuilder.Redirect.appendTo(log))
            .start()

        val timeoutSec = readyTimeoutSeconds.get().coerceAtLeast(1)
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSec.toLong())
        while (System.nanoTime() < deadline) {
            if (isPortOpen(host, port)) {
                logger.lifecycle("vibefly-ui dev server ready at http://{}:{}/", host, port)
                return
            }
            if (!process.isAlive) {
                val exit = process.exitValue()
                throw GradleException(
                    "vibefly-ui dev server exited early (code=$exit). See log: $log",
                )
            }
            Thread.sleep(200)
        }

        process.destroyForcibly()
        throw GradleException(
            "Timed out after ${timeoutSec}s waiting for vibefly-ui at http://$host:$port/. See log: $log",
        )
    }

    companion object {
        const val DEFAULT_DEV_URL: String = "http://127.0.0.1:5173/"

        fun parseHostPort(url: String): Pair<String, Int> {
            val uri = URI(url.trim())
            val host = uri.host?.takeIf { it.isNotBlank() } ?: "127.0.0.1"
            val port = when {
                uri.port > 0 -> uri.port
                uri.scheme.equals("https", ignoreCase = true) -> 443
                else -> 5173
            }
            return host to port
        }

        fun isPortOpen(host: String, port: Int, timeoutMs: Int = 300): Boolean {
            return try {
                Socket().use { socket ->
                    socket.connect(InetSocketAddress(host, port), timeoutMs)
                    true
                }
            } catch (_: Exception) {
                false
            }
        }
    }
}
