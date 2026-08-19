package com.github.sandogeek.jetbrainsvibefly.settings

import com.github.sandogeek.vibefly.jcef.rpc.SettingsDiagnostic
import kotlinx.serialization.json.Json
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.Channels
import java.nio.channels.FileChannel
import java.nio.channels.OverlappingFileLockException
import java.nio.charset.StandardCharsets
import java.nio.file.*
import java.nio.file.attribute.*
import java.util.*
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.thread
import kotlin.concurrent.withLock

internal const val SETTINGS_SCOPE_APPLICATION: String = "application"
internal const val SETTINGS_SCOPE_PROJECT: String = "project"
internal const val PROJECT_SETTINGS_DIRECTORY_NAME: String = ".vibefly"

internal enum class SettingsDocument(
    val fileName: String,
) {
    SETTINGS("settings.json"),
    VIBEFLY("settings.vibefly.json"),
    MODELS("models.json"),
    AUTH("auth.json"),
}

internal fun settingsDocumentOf(fileName: String): SettingsDocument? =
    SettingsDocument.entries.firstOrNull { it.fileName == fileName }

internal data class SettingsScopeSnapshot(
    val scope: String,
    val projectRoot: String?,
    val documents: Map<SettingsDocument, String>,
    val revisions: Map<SettingsDocument, String>,
    val diagnostics: List<SettingsDiagnostic>,
) {
    fun content(document: SettingsDocument): String = documents[document] ?: EMPTY_JSON
    fun revision(document: SettingsDocument): String = revisions[document] ?: ""
}

internal data class StoreSaveResult(
    val ok: Boolean,
    val snapshot: SettingsScopeSnapshot,
    val conflict: Boolean = false,
    val error: String? = null,
)

/**
 * Owns the raw JSON documents for exactly one settings scope.
 *
 * The class has no IntelliJ dependencies so filesystem, revision, and watcher behavior can be
 * covered by focused unit tests. Callers publish [onChanged] through their own lifecycle bus.
 */
internal class SettingsScopeStore(
    private val scope: String,
    projectRoot: String?,
    directory: Path,
    allowedDocuments: Set<SettingsDocument>,
    private val ownerOnlyDirectory: Boolean,
    lockPath: Path? = null,
    private val lockOwnerOnly: Boolean = ownerOnlyDirectory,
    private val permissionSetter: ((Path, Boolean) -> Unit)? = null,
    watcherEnabled: Boolean = true,
    private val debounceMillis: Long = DEFAULT_DEBOUNCE_MILLIS,
    private val onChanged: (SettingsScopeSnapshot, Set<SettingsDocument>) -> Unit = { _, _ -> },
    private val onWarning: (String, Throwable?) -> Unit = { _, _ -> },
) : AutoCloseable {

    private val directory = directory.toAbsolutePath().normalize()
    private val projectRootPath = projectRoot?.let { Path.of(it).toAbsolutePath().normalize() }
    private val projectRoot = projectRootPath?.toString()
    private val scopeLockPath = (lockPath ?: this.directory.resolve(LOCK_FILE_NAME))
        .toAbsolutePath()
        .normalize()
    private val allowedDocuments = allowedDocuments.toSet()
    private val stateLock = ReentrantLock()
    private val documents = EnumMap<SettingsDocument, String>(SettingsDocument::class.java)
    private val revisions = EnumMap<SettingsDocument, String>(SettingsDocument::class.java)
    private val diagnostics = EnumMap<SettingsDocument, SettingsDiagnostic>(SettingsDocument::class.java)
    private val closed = AtomicBoolean(false)

    private var watchService: WatchService? = null
    private var watchThread: Thread? = null
    private var debounceExecutor: ScheduledExecutorService? = null
    private var pendingReload: ScheduledFuture<*>? = null

    /** When true, the next debounced reload refreshes every allowed document. */
    private var pendingFullReload: Boolean = false

    /** Accumulated documents for a partial debounced reload; ignored when [pendingFullReload]. */
    private val pendingPartialDocuments = EnumSet.noneOf(SettingsDocument::class.java)
    private val documentsByFileName = allowedDocuments.associateBy { it.fileName }

    private data class StagedDocument(
        val document: SettingsDocument,
        val target: Path,
        val temporary: Path,
        val backup: Path?,
        var installed: Boolean = false,
    )

    init {
        require(scope == SETTINGS_SCOPE_APPLICATION || scope == SETTINGS_SCOPE_PROJECT) {
            "Unsupported settings scope: $scope"
        }
        require(scope != SETTINGS_SCOPE_APPLICATION || projectRootPath == null) {
            "Application settings cannot have a project root"
        }
        require(scope != SETTINGS_SCOPE_PROJECT || projectRootPath != null) {
            "Project settings require a project root"
        }
        require(allowedDocuments.isNotEmpty()) { "At least one settings document is required" }
        require(
            scope != SETTINGS_SCOPE_PROJECT ||
                    (SettingsDocument.MODELS !in allowedDocuments && SettingsDocument.AUTH !in allowedDocuments),
        ) { "Project settings cannot contain models.json or auth.json" }
        if (scope == SETTINGS_SCOPE_PROJECT) {
            require(directory == projectRootPath!!.resolve(PROJECT_SETTINGS_DIRECTORY_NAME)) {
                "Project settings directory must be <project>/$PROJECT_SETTINGS_DIRECTORY_NAME"
            }
            require(!scopeLockPath.startsWith(projectRootPath)) {
                "Project settings lock must be outside the project root"
            }
            require(lockOwnerOnly) { "Project settings lock must be owner-only" }
        }

        for (document in allowedDocuments) documents[document] = EMPTY_JSON
        for (document in allowedDocuments) revisions[document] = newRevision()
        ensureDirectory()
        loadInitialSnapshot()
        if (watcherEnabled) {
            startWatcher()
            // Close the small load/register race: changes after registration are queued, while
            // changes between the initial load and registration are observed by this refresh.
            try {
                reloadFromDisk()
            } catch (error: Exception) {
                onWarning("Failed to verify initial $scope settings after watcher registration", error)
                scheduleReload()
            }
        }
    }

    fun snapshot(): SettingsScopeSnapshot = stateLock.withLock { snapshotLocked() }

    /** Force an immediate full disk refresh. Repeated equivalent reads do not change revision. */
    fun reloadFromDisk(): SettingsScopeSnapshot = reloadFromDisk(documents = null)

    /**
     * Refresh documents from disk.
     *
     * @param documents `null` refreshes every allowed document; otherwise only the given ones.
     */
    private fun reloadFromDisk(documents: Set<SettingsDocument>?): SettingsScopeSnapshot {
        var changedDocuments: Set<SettingsDocument> = emptySet()
        val snapshot = stateLock.withLock {
            withScopeFileLock {
                changedDocuments = refreshStateLocked(documents)
                snapshotLocked()
            }
        }
        if (changedDocuments.isNotEmpty()) notifyChanged(snapshot, changedDocuments)
        return snapshot
    }

    /** Save a single raw document with file-level optimistic concurrency. */
    fun saveDocument(
        document: SettingsDocument,
        json: String,
        expectedRevision: String,
    ): StoreSaveResult = saveDocuments(mapOf(document to json), expectedRevision)

    /**
     * Save raw documents. Each request should contain exactly one file; extra files are rejected
     * so callers cannot pretend a multi-file write is atomic.
     */
    fun saveDocuments(
        updates: Map<SettingsDocument, String>,
        expectedRevision: String,
    ): StoreSaveResult {
        if (updates.isEmpty()) {
            return StoreSaveResult(ok = true, snapshot = snapshot())
        }
        if (updates.size > 1) {
            return StoreSaveResult(
                ok = false,
                snapshot = snapshot(),
                error = "A save request may update only one settings file",
            )
        }

        val unsupported = updates.keys.firstOrNull { it !in allowedDocuments }
        if (unsupported != null) {
            val current = snapshot()
            return StoreSaveResult(
                ok = false,
                snapshot = current,
                error = "${unsupported.fileName} is not supported for $scope scope",
            )
        }

        val invalid = updates.entries.firstOrNull { (_, raw) -> !isValidJson(raw) }
        if (invalid != null) {
            val current = snapshot()
            return StoreSaveResult(
                ok = false,
                snapshot = current,
                error = "Invalid JSON for ${invalid.key.fileName}",
            )
        }

        var changedDocuments: Set<SettingsDocument> = emptySet()
        val result = try {
            stateLock.withLock {
                withScopeFileLock {
                    changedDocuments = refreshStateLocked()
                    val target = updates.keys.single()
                    if (revisions[target] != expectedRevision) {
                        return@withScopeFileLock StoreSaveResult(
                            ok = false,
                            snapshot = snapshotLocked(),
                            conflict = true,
                            error = REVISION_CONFLICT_MESSAGE,
                        )
                    }

                    try {
                        writeDocumentsAtomically(updates)
                    } catch (error: Exception) {
                        onWarning("Failed to save $scope settings", error)
                        changedDocuments = refreshStateLocked()
                        return@withScopeFileLock StoreSaveResult(
                            ok = false,
                            snapshot = snapshotLocked(),
                            error = "Failed to save settings",
                        )
                    }

                    changedDocuments = refreshStateLocked()
                    StoreSaveResult(ok = true, snapshot = snapshotLocked())
                }
            }
        } catch (error: Exception) {
            onWarning("Failed to lock $scope settings for save", error)
            StoreSaveResult(
                ok = false,
                snapshot = snapshot(),
                error = "Failed to save settings",
            )
        }
        if (changedDocuments.isNotEmpty()) notifyChanged(result.snapshot, changedDocuments)
        return result
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        stateLock.withLock {
            pendingReload?.cancel(false)
            pendingReload = null
        }
        try {
            watchService?.close()
        } catch (_: Exception) {
        }
        watchThread?.interrupt()
        debounceExecutor?.shutdownNow()
        watchService = null
        watchThread = null
        debounceExecutor = null
    }

    private fun loadInitialSnapshot() {
        stateLock.withLock {
            try {
                withScopeFileLock {
                    refreshStateLocked()
                }
            } catch (error: Exception) {
                onWarning("Failed to load initial $scope settings", error)
                for (document in allowedDocuments) {
                    diagnostics[document] = readDiagnostic(document)
                    revisions[document] = newRevision()
                }
            }
        }
    }

    /**
     * Must be called with [stateLock] and the scope file lock held.
     *
     * @param documentsToRefresh `null` refreshes every allowed document; otherwise only those
     * that are also in [allowedDocuments].
     */
    private fun refreshStateLocked(documentsToRefresh: Set<SettingsDocument>? = null): Set<SettingsDocument> {
        ensureDirectory()
        val targets = when (documentsToRefresh) {
            null -> allowedDocuments
            else -> documentsToRefresh.filterTo(EnumSet.noneOf(SettingsDocument::class.java)) {
                it in allowedDocuments
            }
        }
        if (targets.isEmpty()) return emptySet()

        val beforeDocuments = documents.toMap()
        val beforeDiagnostics = diagnostics.toMap()

        for (document in targets) {
            val path = directory.resolve(document.fileName)
            if (Files.notExists(path, LinkOption.NOFOLLOW_LINKS)) {
                documents[document] = EMPTY_JSON
                diagnostics.remove(document)
                continue
            }
            if (Files.isSymbolicLink(path)) {
                diagnostics[document] = readDiagnostic(document)
                continue
            }
            if (!isSafeRegularFile(path)) {
                diagnostics[document] = readDiagnostic(document)
                continue
            }

            try {
                val raw = readUtf8NoFollow(path)
                if (isValidJson(raw)) {
                    documents[document] = raw
                    diagnostics.remove(document)
                } else {
                    diagnostics[document] = invalidJsonDiagnostic(document)
                }
            } catch (error: Exception) {
                // A replace/delete race is equivalent to a missing file on the next pass.
                if (Files.notExists(path, LinkOption.NOFOLLOW_LINKS)) {
                    documents[document] = EMPTY_JSON
                    diagnostics.remove(document)
                } else {
                    diagnostics[document] = readDiagnostic(document)
                    onWarning("Failed to read ${document.fileName}", error)
                }
            }
        }

        val changedDocuments = EnumSet.noneOf(SettingsDocument::class.java)
        for (document in targets) {
            val documentChanged = beforeDocuments[document] != documents[document]
                    || beforeDiagnostics[document] != diagnostics[document]
            if (!documentChanged) continue
            revisions[document] = newRevision()
            changedDocuments.add(document)
        }
        return changedDocuments
    }

    private fun snapshotLocked(): SettingsScopeSnapshot = SettingsScopeSnapshot(
        scope = scope,
        projectRoot = projectRoot,
        documents = documents.toMap(),
        revisions = revisions.toMap(),
        diagnostics = allowedDocuments.mapNotNull(diagnostics::get),
    )

    private fun ensureDirectory() {
        validateProjectRoot()
        if (Files.isSymbolicLink(directory)) {
            throw IOException("Settings directory cannot be a symbolic link")
        }
        Files.createDirectories(directory)
        if (Files.isSymbolicLink(directory) || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) {
            throw IOException("Settings directory is unavailable")
        }
        validateProjectDirectory()
        if (ownerOnlyDirectory) {
            enforceOwnerOnlyPermissions(directory, directory = true)
            for (document in allowedDocuments) {
                val path = directory.resolve(document.fileName)
                if (Files.exists(path, LinkOption.NOFOLLOW_LINKS) && isSafeRegularFile(path)) {
                    enforceOwnerOnlyPermissions(path, directory = false)
                }
            }
        }
    }

    private fun <T> withScopeFileLock(block: () -> T): T {
        ensureDirectory()
        ensureLockFile()
        val channel = FileChannel.open(
            scopeLockPath,
            StandardOpenOption.WRITE,
            LinkOption.NOFOLLOW_LINKS,
        )
        channel.use {
            var lastFailure: Throwable? = null
            repeat(LOCK_ATTEMPTS) { attempt ->
                try {
                    val fileLock = it.tryLock()
                    if (fileLock != null) {
                        fileLock.use { return block() }
                    }
                } catch (error: OverlappingFileLockException) {
                    lastFailure = error
                } catch (error: IOException) {
                    lastFailure = error
                }
                try {
                    Thread.sleep(LOCK_RETRY_MILLIS * (attempt + 1L))
                } catch (interrupted: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw IOException("Interrupted while waiting for settings lock", interrupted)
                }
            }
            throw IOException("Timed out waiting for settings lock", lastFailure)
        }
    }

    private fun writeDocumentsAtomically(updates: Map<SettingsDocument, String>) {
        ensureDirectory()
        val staged = mutableListOf<StagedDocument>()
        try {
            for ((document, raw) in updates) {
                staged += stageDocument(document, raw)
            }
            for (entry in staged) {
                ensureDirectory()
                rejectUnsafeDocument(entry.target, entry.document.fileName)
                moveReplacing(entry.temporary, entry.target, entry.document.fileName)
                entry.installed = true
            }
        } catch (error: Exception) {
            for (entry in staged.asReversed()) {
                if (!entry.installed) continue
                try {
                    val backup = entry.backup
                    if (backup == null) {
                        Files.deleteIfExists(entry.target)
                    } else {
                        moveReplacing(backup, entry.target, "${entry.document.fileName} rollback")
                    }
                } catch (rollbackError: Exception) {
                    error.addSuppressed(rollbackError)
                }
            }
            throw error
        } finally {
            for (entry in staged) {
                Files.deleteIfExists(entry.temporary)
                entry.backup?.let(Files::deleteIfExists)
            }
        }
    }

    private fun stageDocument(document: SettingsDocument, raw: String): StagedDocument {
        val target = directory.resolve(document.fileName)
        rejectUnsafeDocument(target, document.fileName)
        val ownerOnly = ownerOnlyDirectory || document == SettingsDocument.AUTH
        val temporary = Files.createTempFile(directory, ".${document.fileName}.", ".tmp")
        var backup: Path? = null
        try {
            if (ownerOnly) enforceOwnerOnlyPermissions(temporary, directory = false)
            writeForced(temporary, raw.toByteArray(StandardCharsets.UTF_8))

            if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
                backup = Files.createTempFile(directory, ".${document.fileName}.backup.", ".tmp")
                Files.copy(
                    target,
                    backup,
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.COPY_ATTRIBUTES,
                )
                if (ownerOnly) enforceOwnerOnlyPermissions(backup, directory = false)
                FileChannel.open(backup, StandardOpenOption.WRITE).use { it.force(true) }
            }
            return StagedDocument(document, target, temporary, backup)
        } catch (error: Exception) {
            Files.deleteIfExists(temporary)
            backup?.let(Files::deleteIfExists)
            throw error
        }
    }

    private fun writeForced(path: Path, bytes: ByteArray) {
        FileChannel.open(
            path,
            StandardOpenOption.WRITE,
            StandardOpenOption.TRUNCATE_EXISTING,
        ).use { channel ->
            val buffer = ByteBuffer.wrap(bytes)
            while (buffer.hasRemaining()) channel.write(buffer)
            channel.force(true)
        }
    }

    private fun moveReplacing(source: Path, target: Path, label: String) {
        try {
            Files.move(
                source,
                target,
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        } catch (unsupported: AtomicMoveNotSupportedException) {
            onWarning("Atomic move is unavailable for $label; using replacement fallback", unsupported)
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING)
        }
    }

    private fun startWatcher() {
        val watcher = FileSystems.getDefault().newWatchService()
        registerWatcher(watcher)
        val executor = Executors.newSingleThreadScheduledExecutor(daemonThreadFactory("vibefly-settings-debounce"))
        watchService = watcher
        debounceExecutor = executor
        watchThread = thread(
            start = true,
            isDaemon = true,
            name = "vibefly-settings-watch-$scope",
        ) {
            try {
                while (!closed.get()) {
                    val key = watcher.take()
                    var overflow = false
                    val changedDocuments = EnumSet.noneOf(SettingsDocument::class.java)
                    for (event in key.pollEvents()) {
                        if (event.kind() == StandardWatchEventKinds.OVERFLOW) {
                            overflow = true
                            continue
                        }
                        if (overflow) continue
                        val relative = event.context() as? Path ?: continue
                        documentsByFileName[relative.fileName.toString()]?.let(changedDocuments::add)
                    }
                    if (!key.reset()) {
                        if (!recoverWatcherRegistration(watcher)) break
                        // Directory watch was lost; force a full resync after re-register.
                        scheduleReload(delayMillis = 0)
                    } else if (overflow) {
                        scheduleReload()
                    } else if (changedDocuments.isNotEmpty()) {
                        scheduleReload(documents = changedDocuments)
                    }
                }
            } catch (_: ClosedWatchServiceException) {
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            } catch (error: Exception) {
                if (!closed.get()) onWarning("Settings watcher failed for $scope", error)
            }
        }
    }

    private fun registerWatcher(watcher: WatchService) {
        directory.register(
            watcher,
            StandardWatchEventKinds.ENTRY_CREATE,
            StandardWatchEventKinds.ENTRY_MODIFY,
            StandardWatchEventKinds.ENTRY_DELETE,
        )
    }

    private fun recoverWatcherRegistration(watcher: WatchService): Boolean {
        var warned = false
        while (!closed.get()) {
            try {
                ensureDirectory()
                registerWatcher(watcher)
                return true
            } catch (_: ClosedWatchServiceException) {
                return false
            } catch (error: Exception) {
                if (!warned) {
                    warned = true
                    onWarning("Settings directory watcher lost for $scope; retrying", error)
                }
            }
            try {
                Thread.sleep(WATCH_RELOAD_RECOVERY_MILLIS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return false
            }
        }
        return false
    }

    /**
     * @param documents `null` schedules a full refresh of every allowed document; otherwise only
     * those documents are re-read after debounce. Concurrent partial requests are merged; a full
     * request supersedes any pending partial set.
     */
    private fun scheduleReload(
        delayMillis: Long = debounceMillis,
        retryAttempt: Int = 0,
        documents: Set<SettingsDocument>? = null,
    ) {
        val executor = debounceExecutor ?: return
        stateLock.withLock {
            if (closed.get()) return
            if (documents == null) {
                pendingFullReload = true
                pendingPartialDocuments.clear()
            } else if (!pendingFullReload) {
                pendingPartialDocuments.addAll(documents)
            }
            pendingReload?.cancel(false)
            pendingReload = executor.schedule(
                {
                    if (closed.get()) return@schedule
                    val documentsToReload = stateLock.withLock {
                        val scope = if (pendingFullReload) {
                            null
                        } else {
                            pendingPartialDocuments.toSet()
                        }
                        pendingFullReload = false
                        pendingPartialDocuments.clear()
                        pendingReload = null
                        scope
                    }
                    if (documentsToReload != null && documentsToReload.isEmpty()) return@schedule
                    try {
                        reloadFromDisk(documentsToReload)
                    } catch (error: Exception) {
                        if (closed.get()) return@schedule
                        val nextAttempt = retryAttempt + 1
                        if (nextAttempt < WATCH_RELOAD_BURST_ATTEMPTS) {
                            scheduleReload(
                                delayMillis = WATCH_RELOAD_RETRY_MILLIS * nextAttempt,
                                retryAttempt = nextAttempt,
                                documents = documentsToReload,
                            )
                        } else {
                            onWarning("Settings watcher reload failed for $scope; retrying", error)
                            scheduleReload(
                                delayMillis = WATCH_RELOAD_RECOVERY_MILLIS,
                                retryAttempt = 0,
                                documents = documentsToReload,
                            )
                        }
                    }
                },
                delayMillis,
                TimeUnit.MILLISECONDS,
            )
        }
    }

    private fun notifyChanged(snapshot: SettingsScopeSnapshot, changedDocuments: Set<SettingsDocument>) {
        try {
            onChanged(snapshot, changedDocuments)
        } catch (error: Exception) {
            onWarning("Settings change subscriber failed for $scope", error)
        }
    }

    private fun isValidJson(raw: String): Boolean = try {
        JSON.parseToJsonElement(raw)
        true
    } catch (_: Exception) {
        false
    }

    private fun invalidJsonDiagnostic(document: SettingsDocument): SettingsDiagnostic =
        SettingsDiagnostic(
            file = document.fileName,
            severity = "error",
            message = "Invalid JSON",
        )

    private fun readDiagnostic(document: SettingsDocument): SettingsDiagnostic =
        SettingsDiagnostic(
            file = document.fileName,
            severity = "error",
            message = "Unable to read settings file",
        )

    private fun validateProjectRoot() {
        val root = projectRootPath ?: return
        val realRoot = root.toRealPath()
        if (realRoot != root || !Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) {
            throw IOException("Project root is unavailable")
        }
    }

    private fun validateProjectDirectory() {
        val root = projectRootPath ?: return
        if (directory.toRealPath() != root.resolve(PROJECT_SETTINGS_DIRECTORY_NAME)) {
            throw IOException("Project settings directory escapes the project root")
        }
    }

    private fun ensureLockFile() {
        val parent = scopeLockPath.parent ?: throw IOException("Settings lock has no parent directory")
        if (parent == directory) {
            ensureDirectory()
        } else {
            if (Files.isSymbolicLink(parent)) {
                throw IOException("Settings lock directory cannot be a symbolic link")
            }
            Files.createDirectories(parent)
            if (Files.isSymbolicLink(parent) || !Files.isDirectory(parent, LinkOption.NOFOLLOW_LINKS)) {
                throw IOException("Settings lock directory is unavailable")
            }
            val root = projectRootPath
            if (root != null && parent.toRealPath().startsWith(root.toRealPath())) {
                throw IOException("Project settings lock resolves inside the project root")
            }
            if (lockOwnerOnly) enforceOwnerOnlyPermissions(parent, directory = true)
        }

        if (Files.isSymbolicLink(scopeLockPath)) {
            throw IOException("Settings lock cannot be a symbolic link")
        }
        var created = false
        if (Files.notExists(scopeLockPath, LinkOption.NOFOLLOW_LINKS)) {
            try {
                Files.createFile(scopeLockPath)
                created = true
            } catch (_: FileAlreadyExistsException) {
                // Another Host process created the shared lock between the checks.
            }
        }
        if (Files.isSymbolicLink(scopeLockPath) || !isSafeRegularFile(scopeLockPath)) {
            throw IOException("Settings lock is unavailable")
        }
        if (lockOwnerOnly) {
            try {
                enforceOwnerOnlyPermissions(scopeLockPath, directory = false)
            } catch (error: Exception) {
                if (created) {
                    try {
                        Files.deleteIfExists(scopeLockPath)
                    } catch (cleanupError: Exception) {
                        error.addSuppressed(cleanupError)
                    }
                }
                throw error
            }
        }
    }

    private fun rejectUnsafeDocument(path: Path, fileName: String) {
        if (Files.notExists(path, LinkOption.NOFOLLOW_LINKS)) return
        if (Files.isSymbolicLink(path)) {
            throw IOException("Refusing to replace symbolic-link settings file $fileName")
        }
        if (!isSafeRegularFile(path)) {
            throw IOException("Settings file $fileName is not a regular owner inode")
        }
    }

    private fun isSafeRegularFile(path: Path): Boolean {
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) return false
        val links = runCatching {
            (Files.getAttribute(path, "unix:nlink", LinkOption.NOFOLLOW_LINKS) as Number).toLong()
        }.getOrNull()
        return links == null || links <= 1L
    }

    private fun readUtf8NoFollow(path: Path): String =
        FileChannel.open(
            path,
            StandardOpenOption.READ,
            LinkOption.NOFOLLOW_LINKS,
        ).use { channel ->
            Channels.newReader(channel, StandardCharsets.UTF_8).use { it.readText() }
        }

    private fun enforceOwnerOnlyPermissions(path: Path, directory: Boolean) {
        permissionSetter?.let {
            it(path, directory)
            return
        }

        val posix = Files.getFileAttributeView(path, PosixFileAttributeView::class.java)
        if (posix != null) {
            posix.setPermissions(
                if (directory) OWNER_DIRECTORY_PERMISSIONS else OWNER_FILE_PERMISSIONS,
            )
            return
        }

        val acl = Files.getFileAttributeView(path, AclFileAttributeView::class.java)
        if (acl != null) {
            val owner = Files.getOwner(path)
            acl.acl = listOf(
                AclEntry.newBuilder()
                    .setType(AclEntryType.ALLOW)
                    .setPrincipal(owner)
                    .setPermissions(AclEntryPermission.entries.toSet())
                    .build(),
            )
            return
        }
        throw IOException("Unable to restrict permissions for ${path.fileName}")
    }

    companion object {
        private val JSON = Json
        private const val LOCK_FILE_NAME = ".settings.lock"
        private const val LOCK_ATTEMPTS = 10
        private const val LOCK_RETRY_MILLIS = 20L
        private const val DEFAULT_DEBOUNCE_MILLIS = 100L
        private const val WATCH_RELOAD_BURST_ATTEMPTS = 3
        private const val WATCH_RELOAD_RETRY_MILLIS = 100L
        private const val WATCH_RELOAD_RECOVERY_MILLIS = 1_000L
        private const val REVISION_CONFLICT_MESSAGE = "Settings revision conflict"

        private val OWNER_DIRECTORY_PERMISSIONS = setOf(
            PosixFilePermission.OWNER_READ,
            PosixFilePermission.OWNER_WRITE,
            PosixFilePermission.OWNER_EXECUTE,
        )
        private val OWNER_FILE_PERMISSIONS = setOf(
            PosixFilePermission.OWNER_READ,
            PosixFilePermission.OWNER_WRITE,
        )

        private fun newRevision(): String = UUID.randomUUID().toString()

        private fun daemonThreadFactory(name: String): ThreadFactory = ThreadFactory { task ->
            Thread(task, name).apply { isDaemon = true }
        }
    }
}

internal const val EMPTY_JSON: String = "{}"
