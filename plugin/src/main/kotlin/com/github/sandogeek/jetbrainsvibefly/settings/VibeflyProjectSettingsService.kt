package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.jetbrainsvibefly.agent.VibeflyAgentDirectory
import com.github.sandogeek.vibefly.jcef.rpc.SettingsSaveResult
import com.github.sandogeek.vibefly.jcef.rpc.SettingsFileChange
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.*

@Service(Service.Level.PROJECT)
class VibeflyProjectSettingsService(project: Project) : Disposable {
    internal val projectRoot: String? = normalizeProjectRoot(project.basePath)

    private val store: SettingsScopeStore? = projectRoot?.let(::createStore)

    internal fun snapshot(refresh: Boolean = false): SettingsScopeSnapshot {
        val active = store ?: error("Project settings are unavailable")
        return if (refresh) active.reloadFromDisk() else active.snapshot()
    }

    internal fun saveDocument(
        document: SettingsDocument,
        json: String,
        expectedRevision: String,
    ): SettingsSaveResult {
        val active = store ?: return SettingsSaveResult(
            ok = false,
            revision = "unavailable",
            error = "Project settings are unavailable",
        )
        return active.saveDocument(document, json, expectedRevision).toRpcResult(document)
    }

    override fun dispose() {
        store?.close()
    }

    private fun publishChanged(snapshot: SettingsScopeSnapshot, changedDocuments: Set<SettingsDocument>) {
        if (changedDocuments.isEmpty()) return
        ApplicationManager.getApplication().messageBus
            .syncPublisher(VIBEFLY_SETTINGS_TOPIC)
            .settingsChanged(
                VibeflySettingsChanged(
                    scope = snapshot.scope,
                    projectRoot = snapshot.projectRoot,
                    changes = changedDocuments.map { document ->
                        SettingsFileChange(
                            scope = snapshot.scope,
                            projectRoot = snapshot.projectRoot,
                            document = document.fileName,
                            revision = snapshot.revision(document),
                        )
                    },
                ),
            )
    }

    private fun createStore(root: String): SettingsScopeStore? = try {
        SettingsScopeStore(
            scope = SETTINGS_SCOPE_PROJECT,
            projectRoot = root,
            directory = Path.of(root).resolve(PROJECT_SETTINGS_DIRECTORY_NAME),
            allowedDocuments = setOf(SettingsDocument.SETTINGS, SettingsDocument.VIBEFLY),
            ownerOnlyDirectory = false,
            lockPath = projectLockPath(root),
            lockOwnerOnly = true,
            onChanged = ::publishChanged,
            onWarning = { message, error ->
                if (error == null) log.warn(message) else log.warn(message, error)
            },
        )
    } catch (error: Exception) {
        // A malformed project path (including a symlinked .vibefly directory) must not
        // prevent the IDE project from opening. RPC reads/saves report the unavailable
        // settings scope instead.
        log.warn("Failed to initialize project settings store", error)
        null
    }

    companion object {
        private val log = logger<VibeflyProjectSettingsService>()

        fun getInstance(project: Project): VibeflyProjectSettingsService =
            project.getService(VibeflyProjectSettingsService::class.java)

        internal fun projectLockPath(root: String, productCode: String = VibeflyAgentDirectory.productCode()): Path {
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(root.toByteArray(StandardCharsets.UTF_8))
            val fileName = HexFormat.of().formatHex(digest) + ".lock"
            val vibeflyRoot = requireNotNull(
                requireNotNull(VibeflyAgentDirectory.resolve(productCode).parent).parent,
            )
            return vibeflyRoot.resolve(PROJECT_LOCK_DIRECTORY).resolve(fileName)
        }

        private fun normalizeProjectRoot(raw: String?): String? {
            val value = raw?.trim()?.takeIf(String::isNotEmpty) ?: return null
            return try {
                val path = Path.of(value).toAbsolutePath().normalize()
                if (!Files.isDirectory(path)) return null
                path.toRealPath().toString()
            } catch (_: Exception) {
                null
            }
        }

        private const val PROJECT_LOCK_DIRECTORY = "locks/projects"
    }
}
