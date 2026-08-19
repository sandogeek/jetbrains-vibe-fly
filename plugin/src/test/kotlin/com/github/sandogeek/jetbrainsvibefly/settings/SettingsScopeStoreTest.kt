package com.github.sandogeek.jetbrainsvibefly.settings

import org.junit.Assert.*
import org.junit.Assume.assumeNoException
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.util.concurrent.TimeUnit

class SettingsScopeStoreTest {
    @Rule
    @JvmField
    val temporaryFolder = TemporaryFolder()

    @Test
    fun `missing files are empty and each file save has its own revision`() {
        val directory = newDirectory("application")
        var changes = 0
        SettingsScopeStore(
            scope = SETTINGS_SCOPE_APPLICATION,
            projectRoot = null,
            directory = directory,
            allowedDocuments = SettingsDocument.entries.toSet(),
            ownerOnlyDirectory = true,
            watcherEnabled = false,
            onChanged = { _, _ -> changes += 1 },
        ).use { store ->
            val initial = store.snapshot()
            assertTrue(initial.documents.values.all { it == EMPTY_JSON })
            assertFalse(Files.exists(directory.resolve("settings.json")))
            assertFalse(Files.exists(directory.resolve("auth.json")))

            val savedSettings = store.saveDocument(
                SettingsDocument.SETTINGS,
                "{\"defaultProvider\":\"openai\"}",
                initial.revision(SettingsDocument.SETTINGS),
            )
            val savedVibefly = store.saveDocument(
                SettingsDocument.VIBEFLY,
                "{\"locale\":\"zh\"}",
                initial.revision(SettingsDocument.VIBEFLY),
            )
            assertTrue(savedSettings.ok)
            assertTrue(savedVibefly.ok)
            assertNotEquals(
                initial.revision(SettingsDocument.SETTINGS),
                savedSettings.snapshot.revision(SettingsDocument.SETTINGS),
            )
            assertNotEquals(
                initial.revision(SettingsDocument.VIBEFLY),
                savedVibefly.snapshot.revision(SettingsDocument.VIBEFLY),
            )
            assertEquals(2, changes)
            assertTrue(Files.readString(directory.resolve("settings.json")).contains("openai"))
            assertFalse(hasTemporaryFiles(directory))

            val conflict = store.saveDocuments(
                mapOf(SettingsDocument.SETTINGS to "{\"defaultProvider\":\"other\"}"),
                initial.revision(SettingsDocument.SETTINGS),
            )
            assertFalse(conflict.ok)
            assertTrue(conflict.conflict)
            assertEquals(
                savedSettings.snapshot.revision(SettingsDocument.SETTINGS),
                conflict.snapshot.revision(SettingsDocument.SETTINGS),
            )
            assertTrue(Files.readString(directory.resolve("settings.json")).contains("openai"))
        }
    }

    @Test
    fun `models and auth saves use independent revisions`() {
        val directory = newDirectory("provider-documents")
        var changes = 0
        SettingsScopeStore(
            scope = SETTINGS_SCOPE_APPLICATION,
            projectRoot = null,
            directory = directory,
            allowedDocuments = setOf(SettingsDocument.MODELS, SettingsDocument.AUTH),
            ownerOnlyDirectory = true,
            watcherEnabled = false,
            onChanged = { _, _ -> changes += 1 },
        ).use { store ->
            val initial = store.snapshot()
            val savedModels = store.saveDocument(
                SettingsDocument.MODELS,
                """{"providers":{"private":{"baseUrl":"https://a","api":"openai-completions","models":[{"id":"m"}]}}}""",
                initial.revision(SettingsDocument.MODELS),
            )
            val savedAuth = store.saveDocument(
                SettingsDocument.AUTH,
                """{"private":{"type":"api_key","key":"secret"}}""",
                initial.revision(SettingsDocument.AUTH),
            )
            assertTrue(savedModels.ok)
            assertTrue(savedAuth.ok)
            assertNotEquals(initial.revision(SettingsDocument.MODELS), savedModels.snapshot.revision(SettingsDocument.MODELS))
            assertNotEquals(initial.revision(SettingsDocument.AUTH), savedAuth.snapshot.revision(SettingsDocument.AUTH))
            assertEquals(2, changes)
            assertTrue(Files.readString(directory.resolve("models.json")).contains("private"))
            assertTrue(Files.readString(directory.resolve("auth.json")).contains("secret"))
        }
    }

    @Test
    fun `models-only save leaves auth file unchanged`() {
        val directory = newDirectory("models-only")
        Files.writeString(directory.resolve("auth.json"), """{"private":{"type":"api_key","key":"secret"}}""")
        SettingsScopeStore(
            scope = SETTINGS_SCOPE_APPLICATION,
            projectRoot = null,
            directory = directory,
            allowedDocuments = setOf(SettingsDocument.MODELS, SettingsDocument.AUTH),
            ownerOnlyDirectory = true,
            watcherEnabled = false,
        ).use { store ->
            val initial = store.snapshot()
            val saved = store.saveDocuments(
                mapOf(
                    SettingsDocument.MODELS to """{"providers":{"private":{"baseUrl":"https://a","api":"openai-completions","models":[{"id":"m"}]}}}""",
                ),
                initial.revision(SettingsDocument.MODELS),
            )
            assertTrue(saved.ok)
            assertTrue(Files.readString(directory.resolve("models.json")).contains("private"))
            assertEquals(
                """{"private":{"type":"api_key","key":"secret"}}""",
                Files.readString(directory.resolve("auth.json")),
            )
        }
    }

    @Test
    fun `invalid external JSON preserves last valid content and only changes revision once`() {
        val directory = newDirectory("last-valid")
        val settingsPath = directory.resolve("settings.json")
        Files.writeString(settingsPath, "{\"defaultModel\":\"good\"}")
        SettingsScopeStore(
            scope = SETTINGS_SCOPE_APPLICATION,
            projectRoot = null,
            directory = directory,
            allowedDocuments = setOf(SettingsDocument.SETTINGS),
            ownerOnlyDirectory = true,
            watcherEnabled = false,
        ).use { store ->
            val valid = store.snapshot()
            Files.writeString(settingsPath, "{not-json")

            val invalid = store.reloadFromDisk()
            assertEquals(valid.content(SettingsDocument.SETTINGS), invalid.content(SettingsDocument.SETTINGS))
            assertEquals("Invalid JSON", invalid.diagnostics.single().message)
            assertNotEquals(valid.revision(SettingsDocument.SETTINGS), invalid.revision(SettingsDocument.SETTINGS))
            assertEquals(invalid.revision(SettingsDocument.SETTINGS), store.reloadFromDisk().revision(SettingsDocument.SETTINGS))

            Files.writeString(settingsPath, "{\"defaultModel\":\"fixed\"}")
            val fixed = store.reloadFromDisk()
            assertTrue(fixed.content(SettingsDocument.SETTINGS).contains("fixed"))
            assertTrue(fixed.diagnostics.isEmpty())
            assertNotEquals(invalid.revision(SettingsDocument.SETTINGS), fixed.revision(SettingsDocument.SETTINGS))
        }
    }

    @Test
    fun `RPC invalid JSON is rejected without disk or revision changes`() {
        val projectRoot = newDirectory("invalid-save-project")
        val directory = projectRoot.resolve(PROJECT_SETTINGS_DIRECTORY_NAME)
        SettingsScopeStore(
            scope = SETTINGS_SCOPE_PROJECT,
            projectRoot = projectRoot.toString(),
            directory = directory,
            allowedDocuments = setOf(SettingsDocument.SETTINGS, SettingsDocument.VIBEFLY),
            ownerOnlyDirectory = false,
            lockPath = newLockPath("invalid-save"),
            lockOwnerOnly = true,
            watcherEnabled = false,
        ).use { store ->
            val initial = store.snapshot()
            val result = store.saveDocuments(
                mapOf(SettingsDocument.SETTINGS to "[broken"),
                initial.revision(SettingsDocument.SETTINGS),
            )
            assertFalse(result.ok)
            assertFalse(result.conflict)
            assertEquals(initial.revision(SettingsDocument.SETTINGS), result.snapshot.revision(SettingsDocument.SETTINGS))
            assertFalse(Files.exists(directory.resolve("settings.json")))

            val unsupported = store.saveDocuments(
                mapOf(SettingsDocument.AUTH to "{}"),
                initial.revision(SettingsDocument.SETTINGS),
            )
            assertFalse(unsupported.ok)
            assertTrue(unsupported.error.orEmpty().contains("not supported"))
        }
    }

    @Test
    fun `watcher converges after create replace and delete`() {
        val projectRoot = newDirectory("watcher-project")
        val directory = projectRoot.resolve(PROJECT_SETTINGS_DIRECTORY_NAME)
        val settingsPath = directory.resolve("settings.json")
        SettingsScopeStore(
            scope = SETTINGS_SCOPE_PROJECT,
            projectRoot = projectRoot.toString(),
            directory = directory,
            allowedDocuments = setOf(SettingsDocument.SETTINGS, SettingsDocument.VIBEFLY),
            ownerOnlyDirectory = false,
            lockPath = newLockPath("watcher"),
            lockOwnerOnly = true,
            watcherEnabled = true,
            debounceMillis = 20,
        ).use { store ->
            Files.writeString(settingsPath, "{\"value\":1}")
            assertTrue(await { store.snapshot().content(SettingsDocument.SETTINGS).contains("1") })

            val replacement = directory.resolve("replacement.json")
            Files.writeString(replacement, "{\"value\":2}")
            Files.move(replacement, settingsPath, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
            assertTrue(await { store.snapshot().content(SettingsDocument.SETTINGS).contains("2") })

            Files.delete(settingsPath)
            assertTrue(await { store.snapshot().content(SettingsDocument.SETTINGS) == EMPTY_JSON })
        }
    }

    @Test
    fun `watcher re-registers after the settings directory is recreated`() {
        val projectRoot = newDirectory("watcher-recreate-project")
        val directory = projectRoot.resolve(PROJECT_SETTINGS_DIRECTORY_NAME)
        SettingsScopeStore(
            scope = SETTINGS_SCOPE_PROJECT,
            projectRoot = projectRoot.toString(),
            directory = directory,
            allowedDocuments = setOf(SettingsDocument.SETTINGS, SettingsDocument.VIBEFLY),
            ownerOnlyDirectory = false,
            lockPath = newLockPath("watcher-recreate"),
            lockOwnerOnly = true,
            watcherEnabled = true,
            debounceMillis = 20,
        ).use { store ->
            Files.delete(directory)
            assertTrue(await(5) { Files.isDirectory(directory) })
            Files.writeString(directory.resolve(SettingsDocument.SETTINGS.fileName), "{\"value\":9}")
            assertTrue(await(5) {
                store.snapshot().content(SettingsDocument.SETTINGS).contains("9")
            })
        }
    }

    @Test
    fun `project settings reject a symlinked directory outside the project`() {
        val projectRoot = newDirectory("symlink-directory-project")
        val outside = newDirectory("symlink-directory-outside")
        val directory = projectRoot.resolve(PROJECT_SETTINGS_DIRECTORY_NAME)
        try {
            Files.createSymbolicLink(directory, outside)
        } catch (error: Exception) {
            assumeNoException(error)
        }

        try {
            SettingsScopeStore(
                scope = SETTINGS_SCOPE_PROJECT,
                projectRoot = projectRoot.toString(),
                directory = directory,
                allowedDocuments = setOf(SettingsDocument.SETTINGS, SettingsDocument.VIBEFLY),
                ownerOnlyDirectory = false,
                lockPath = newLockPath("symlink-directory"),
                lockOwnerOnly = true,
                watcherEnabled = false,
            ).close()
            fail("Expected the symlinked project settings directory to be rejected")
        } catch (_: IOException) {
        }
    }

    @Test
    fun `project settings never read or replace a symlinked file`() {
        val projectRoot = newDirectory("symlink-file-project")
        val directory = Files.createDirectory(projectRoot.resolve(PROJECT_SETTINGS_DIRECTORY_NAME))
        val outside = temporaryFolder.newFile("outside-settings.json").toPath()
        Files.writeString(outside, "{\"outside\":true}")
        val settingsPath = directory.resolve(SettingsDocument.SETTINGS.fileName)
        try {
            Files.createSymbolicLink(settingsPath, outside)
        } catch (error: Exception) {
            assumeNoException(error)
        }

        SettingsScopeStore(
            scope = SETTINGS_SCOPE_PROJECT,
            projectRoot = projectRoot.toString(),
            directory = directory,
            allowedDocuments = setOf(SettingsDocument.SETTINGS, SettingsDocument.VIBEFLY),
            ownerOnlyDirectory = false,
            lockPath = newLockPath("symlink-file"),
            lockOwnerOnly = true,
            watcherEnabled = false,
        ).use { store ->
            val initial = store.snapshot()
            assertEquals(EMPTY_JSON, initial.content(SettingsDocument.SETTINGS))
            assertEquals(SettingsDocument.SETTINGS.fileName, initial.diagnostics.single().file)

            val result = store.saveDocuments(
                mapOf(SettingsDocument.SETTINGS to "{\"inside\":true}"),
                initial.revision(SettingsDocument.SETTINGS),
            )
            assertFalse(result.ok)
            assertTrue(Files.isSymbolicLink(settingsPath))
            assertEquals("{\"outside\":true}", Files.readString(outside))
        }
    }

    @Test
    fun `credential save fails when owner-only permissions cannot be applied`() {
        val directory = newDirectory("permission-failure")
        SettingsScopeStore(
            scope = SETTINGS_SCOPE_APPLICATION,
            projectRoot = null,
            directory = directory,
            allowedDocuments = SettingsDocument.entries.toSet(),
            ownerOnlyDirectory = true,
            permissionSetter = { path, isDirectory ->
                if (!isDirectory && path.fileName.toString().startsWith(".auth.json.")) {
                    throw IOException("permission denied")
                }
            },
            watcherEnabled = false,
        ).use { store ->
            val initial = store.snapshot()
            val result = store.saveDocuments(
                mapOf(SettingsDocument.AUTH to "{\"openai\":{\"type\":\"api_key\",\"key\":\"secret\"}}"),
                initial.revision(SettingsDocument.AUTH),
            )

            assertFalse(result.ok)
            assertEquals(initial.revision(SettingsDocument.AUTH), result.snapshot.revision(SettingsDocument.AUTH))
            assertFalse(Files.exists(directory.resolve(SettingsDocument.AUTH.fileName)))
            assertFalse(hasTemporaryFiles(directory))
        }
    }

    @Test
    fun `multi-document save is rejected without changing any file`() {
        val directory = newDirectory("multi-document-rejected")
        val settingsPath = directory.resolve(SettingsDocument.SETTINGS.fileName)
        val authPath = directory.resolve(SettingsDocument.AUTH.fileName)
        val originalSettings = "{\"defaultProvider\":\"original\"}"
        val originalAuth = "{\"private\":{\"type\":\"api_key\",\"key\":\"old-secret\"}}"
        Files.writeString(settingsPath, originalSettings)
        Files.writeString(authPath, originalAuth)
        var changes = 0

        SettingsScopeStore(
            scope = SETTINGS_SCOPE_APPLICATION,
            projectRoot = null,
            directory = directory,
            allowedDocuments = SettingsDocument.entries.toSet(),
            ownerOnlyDirectory = true,
            watcherEnabled = false,
            onChanged = { _, _ -> changes += 1 },
        ).use { store ->
            val initial = store.snapshot()
            val result = store.saveDocuments(
                linkedMapOf(
                    SettingsDocument.SETTINGS to "{\"defaultProvider\":\"replacement\"}",
                    SettingsDocument.AUTH to
                            "{\"private\":{\"type\":\"api_key\",\"key\":\"new-secret\"}}",
                ),
                initial.revision(SettingsDocument.SETTINGS),
            )

            assertFalse(result.ok)
            assertFalse(result.conflict)
            assertTrue(result.error.orEmpty().contains("only one settings file"))
            assertEquals(initial.revision(SettingsDocument.SETTINGS), result.snapshot.revision(SettingsDocument.SETTINGS))
            assertEquals(initial.revision(SettingsDocument.AUTH), result.snapshot.revision(SettingsDocument.AUTH))
            assertEquals(originalSettings, Files.readString(settingsPath))
            assertEquals(originalAuth, Files.readString(authPath))
            assertEquals(0, changes)
            assertFalse(hasTemporaryFiles(directory))
        }
    }

    @Test
    fun `single-file install failure leaves the target unchanged`() {
        val directory = newDirectory("single-file-install-failure")
        val settingsPath = directory.resolve(SettingsDocument.SETTINGS.fileName)
        val originalSettings = "{\"defaultProvider\":\"original\"}"
        Files.writeString(settingsPath, originalSettings)
        var failureInjected = false
        var changes = 0

        SettingsScopeStore(
            scope = SETTINGS_SCOPE_APPLICATION,
            projectRoot = null,
            directory = directory,
            allowedDocuments = setOf(SettingsDocument.SETTINGS),
            ownerOnlyDirectory = true,
            permissionSetter = { path, isDirectory ->
                if (!failureInjected && !isDirectory && path.fileName.toString().startsWith(".settings.json.")) {
                    failureInjected = true
                    throw IOException("permission denied")
                }
            },
            watcherEnabled = false,
            onChanged = { _, _ -> changes += 1 },
        ).use { store ->
            val initial = store.snapshot()
            val result = store.saveDocument(
                SettingsDocument.SETTINGS,
                "{\"defaultProvider\":\"replacement\"}",
                initial.revision(SettingsDocument.SETTINGS),
            )

            assertTrue(failureInjected)
            assertFalse(result.ok)
            assertEquals(initial.revision(SettingsDocument.SETTINGS), result.snapshot.revision(SettingsDocument.SETTINGS))
            assertEquals(originalSettings, Files.readString(settingsPath))
            assertEquals(0, changes)
            assertFalse(hasTemporaryFiles(directory))
        }
    }

    @Test
    fun `FIFO settings file is rejected without reading or replacing it`() {
        val directory = newDirectory("fifo-file")
        val settingsPath = directory.resolve(SettingsDocument.SETTINGS.fileName)
        val mkfifo = try {
            ProcessBuilder("mkfifo", settingsPath.toString()).start()
        } catch (error: Exception) {
            assumeNoException(error)
            return
        }
        assumeTrue("mkfifo is unavailable", mkfifo.waitFor() == 0)
        val writer = try {
            ProcessBuilder(
                "sh",
                "-c",
                "printf '{\"fifo\":true}' > \"\$1\"",
                "sh",
                settingsPath.toString(),
            ).start()
        } catch (error: Exception) {
            assumeNoException(error)
            return
        }

        try {
            SettingsScopeStore(
                scope = SETTINGS_SCOPE_APPLICATION,
                projectRoot = null,
                directory = directory,
                allowedDocuments = setOf(SettingsDocument.SETTINGS),
                ownerOnlyDirectory = false,
                watcherEnabled = false,
            ).use { store ->
                val snapshot = store.snapshot()
                assertEquals(EMPTY_JSON, snapshot.content(SettingsDocument.SETTINGS))
                assertEquals(SettingsDocument.SETTINGS.fileName, snapshot.diagnostics.single().file)

                val result = store.saveDocuments(
                    mapOf(SettingsDocument.SETTINGS to "{\"inside\":true}"),
                    snapshot.revision(SettingsDocument.SETTINGS),
                )
                assertFalse(result.ok)
                assertTrue(Files.exists(settingsPath, LinkOption.NOFOLLOW_LINKS))
                assertFalse(Files.isRegularFile(settingsPath, LinkOption.NOFOLLOW_LINKS))
            }
        } finally {
            writer.destroyForcibly()
            writer.waitFor(2, TimeUnit.SECONDS)
        }
    }

    @Test
    fun `multiply linked settings file is rejected without changing either link`() {
        val directory = newDirectory("hard-link-file")
        val outside = temporaryFolder.newFile("hard-link-outside.json").toPath()
        val original = "{\"outside\":true}"
        Files.writeString(outside, original)
        val settingsPath = directory.resolve(SettingsDocument.SETTINGS.fileName)
        try {
            Files.createLink(settingsPath, outside)
        } catch (error: Exception) {
            assumeNoException(error)
        }
        val linkCount = try {
            (Files.getAttribute(settingsPath, "unix:nlink", LinkOption.NOFOLLOW_LINKS) as Number).toLong()
        } catch (error: Exception) {
            assumeNoException(error)
            return
        }
        assumeTrue("hard-link count is unavailable", linkCount > 1L)

        SettingsScopeStore(
            scope = SETTINGS_SCOPE_APPLICATION,
            projectRoot = null,
            directory = directory,
            allowedDocuments = setOf(SettingsDocument.SETTINGS),
            ownerOnlyDirectory = false,
            watcherEnabled = false,
        ).use { store ->
            val snapshot = store.snapshot()
            assertEquals(EMPTY_JSON, snapshot.content(SettingsDocument.SETTINGS))
            assertEquals(SettingsDocument.SETTINGS.fileName, snapshot.diagnostics.single().file)

            val result = store.saveDocuments(
                mapOf(SettingsDocument.SETTINGS to "{\"inside\":true}"),
                snapshot.revision(SettingsDocument.SETTINGS),
            )
            assertFalse(result.ok)
            assertTrue(Files.isSameFile(settingsPath, outside))
            assertEquals(original, Files.readString(outside))
        }
    }

    @Test
    fun `multiply linked scope lock is rejected`() {
        val directory = newDirectory("hard-link-lock")
        val outside = temporaryFolder.newFile("hard-link-lock-outside").toPath()
        val lockPath = directory.resolve("settings.lock")
        try {
            Files.createLink(lockPath, outside)
        } catch (error: Exception) {
            assumeNoException(error)
        }
        val linkCount = try {
            (Files.getAttribute(lockPath, "unix:nlink", LinkOption.NOFOLLOW_LINKS) as Number).toLong()
        } catch (error: Exception) {
            assumeNoException(error)
            return
        }
        assumeTrue("hard-link count is unavailable", linkCount > 1L)

        SettingsScopeStore(
            scope = SETTINGS_SCOPE_APPLICATION,
            projectRoot = null,
            directory = directory,
            allowedDocuments = setOf(SettingsDocument.SETTINGS),
            ownerOnlyDirectory = false,
            lockPath = lockPath,
            watcherEnabled = false,
        ).use { store ->
            val result = store.saveDocuments(
                mapOf(SettingsDocument.SETTINGS to "{\"inside\":true}"),
                store.snapshot().revision(SettingsDocument.SETTINGS),
            )
            assertFalse(result.ok)
            assertTrue(Files.isSameFile(lockPath, outside))
            assertFalse(Files.exists(directory.resolve(SettingsDocument.SETTINGS.fileName)))
        }
    }

    @Test
    fun `watcher retries after a scope lock timeout and leaves no project lock file`() {
        val projectRoot = newDirectory("watcher-lock-project")
        val directory = projectRoot.resolve(PROJECT_SETTINGS_DIRECTORY_NAME)
        val lockPath = newLockPath("watcher-lock")
        val settingsPath = directory.resolve(SettingsDocument.SETTINGS.fileName)
        SettingsScopeStore(
            scope = SETTINGS_SCOPE_PROJECT,
            projectRoot = projectRoot.toString(),
            directory = directory,
            allowedDocuments = setOf(SettingsDocument.SETTINGS, SettingsDocument.VIBEFLY),
            ownerOnlyDirectory = false,
            lockPath = lockPath,
            lockOwnerOnly = true,
            watcherEnabled = true,
            debounceMillis = 20,
        ).use { store ->
            assertFalse(Files.exists(directory.resolve(".settings.lock")))
            FileChannel.open(lockPath, StandardOpenOption.WRITE).use { channel ->
                channel.lock().use {
                    Files.writeString(settingsPath, "{\"value\":7}")
                    Thread.sleep(1_300)
                }
            }
            assertTrue(await(5) {
                store.snapshot().content(SettingsDocument.SETTINGS).contains("7")
            })
        }
    }

    private fun newDirectory(name: String): Path = temporaryFolder.newFolder(name).toPath().toRealPath()

    private fun newLockPath(name: String): Path =
        newDirectory("$name-locks").resolve("settings.lock")

    private fun hasTemporaryFiles(directory: Path): Boolean =
        Files.list(directory).use { paths -> paths.anyMatch { it.fileName.toString().endsWith(".tmp") } }

    private fun await(seconds: Long = 3, condition: () -> Boolean): Boolean {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        while (System.nanoTime() < deadline) {
            if (condition()) return true
            Thread.sleep(20)
        }
        return condition()
    }
}
