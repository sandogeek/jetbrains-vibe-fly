import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * Waits until the vibefly-ui Vite dev server is listening (no auto-start).
 * Use with IDE **Run UI Dev** / Compound **Run Plugin + UI Dev**, or `npm run dev`.
 */
abstract class WaitVibeflyUiDevServerTask : DefaultTask() {

    /** When false, the task is a no-op. */
    @get:Input
    abstract val uiDevEnabled: Property<Boolean>

    /** e.g. `http://127.0.0.1:5173/` — host/port are parsed from this URL. */
    @get:Input
    abstract val devUrl: Property<String>

    @get:Input
    abstract val readyTimeoutSeconds: Property<Int>

    @TaskAction
    fun waitForServer() {
        if (!uiDevEnabled.get()) {
            logger.info("waitVibeflyUiDevServer skipped (ui.dev not enabled)")
            return
        }

        val url = devUrl.get().trim().ifEmpty { DEFAULT_DEV_URL }
        val (host, port) = parseHostPort(url)
        val timeoutSec = readyTimeoutSeconds.get().coerceAtLeast(1)

        if (isPortOpen(host, port)) {
            logger.lifecycle("vibefly-ui dev server already running at http://{}:{}/", host, port)
            return
        }

        logger.lifecycle(
            "Waiting for vibefly-ui at http://{}:{}/ (start IDE \"Run UI Dev\" / ./gradlew runVibeflyUiDev)",
            host,
            port,
        )

        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSec.toLong())
        while (System.nanoTime() < deadline) {
            if (isPortOpen(host, port)) {
                logger.lifecycle("vibefly-ui dev server ready at http://{}:{}/", host, port)
                return
            }
            Thread.sleep(200)
        }

        throw GradleException(
            "Timed out after ${timeoutSec}s waiting for vibefly-ui at http://$host:$port/. " +
                "Start IDE \"Run UI Dev\" (./gradlew runVibeflyUiDev) or Compound \"Run Plugin + UI Dev\".",
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
