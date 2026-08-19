package com.github.sandogeek.jetbrainsvibefly.commit

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.jetbrainsvibefly.VibeflyNotifications
import com.github.sandogeek.jetbrainsvibefly.agent.VibeflyAgentService
import com.github.sandogeek.jetbrainsvibefly.util.Edt
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vcs.CommitMessageI
import com.intellij.openapi.vcs.FilePath
import com.intellij.openapi.vcs.VcsDataKeys
import com.intellij.openapi.vcs.changes.Change
import com.intellij.openapi.vcs.changes.ChangeListManager
import com.intellij.openapi.vcs.changes.CurrentContentRevision
import com.intellij.vcs.commit.CommitMessageUi
import com.intellij.vcs.commit.CommitWorkflowUi
import kotlinx.coroutines.*
import java.util.*
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.time.Duration.Companion.milliseconds

/**
 * Commit message area action: generate Conventional Commits English message
 * from currently included/checked changes via Host2Agent + Node pi-ai.
 */
class GenerateCommitMessageAction : AnAction(), DumbAware {

    private val generating = AtomicBoolean(false)

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        val project = e.project
        e.presentation.isEnabled = project != null && !generating.get()
        e.presentation.isVisible = true
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        if (!generating.compareAndSet(false, true)) return

        val commitMessage = resolveCommitMessageWriter(e)
        if (commitMessage == null) {
            generating.set(false)
            VibeflyNotifications.notify(
                project,
                VibeflyBundle.message("commit.generate.error.title"),
                VibeflyBundle.message("commit.generate.error.noControl"),
                NotificationType.WARNING,
            )
            return
        }

        val changes = resolveIncludedChanges(e, project)
        if (changes.isEmpty()) {
            generating.set(false)
            VibeflyNotifications.notify(
                project,
                VibeflyBundle.message("commit.generate.error.title"),
                VibeflyBundle.message("commit.generate.error.noChanges"),
                NotificationType.INFORMATION,
            )
            return
        }

        ProgressManager.getInstance().run(object : Task.Backgroundable(
            project,
            VibeflyBundle.message("commit.generate.progress"),
            true,
        ) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    indicator.isIndeterminate = true
                    indicator.text = VibeflyBundle.message("commit.generate.progress.collect")
                    if (indicator.isCanceled) throw ProcessCanceledException()

                    val collected = CommitDiffCollector.collect(project, changes)
                    if (collected.files.isEmpty()) {
                        Edt.later {
                            VibeflyNotifications.notify(
                                project,
                                VibeflyBundle.message("commit.generate.error.title"),
                                VibeflyBundle.message("commit.generate.error.noChanges"),
                                NotificationType.INFORMATION,
                            )
                        }
                        return
                    }

                    indicator.text = VibeflyBundle.message("commit.generate.progress.rpc")
                    if (indicator.isCanceled) throw ProcessCanceledException()

                    val request = collected.toRequest(
                        // The Agent resolves configured language/model/prompt from the latest
                        // Host snapshot. This value is only the IDE-locale fallback.
                        language = if (Locale.getDefault().language.equals("zh", true)) "zh" else "en",
                    )

                    val agent = VibeflyAgentService.getInstance(project)
                    // Progress cancel must cancel the coroutine Job so SimpleRpc sends
                    // wire cancel and the agent aborts streamSimple via AbortSignal.
                    val result = runBlocking {
                        awaitWithProgressCancel(indicator) {
                            agent.generateCommitMessage(request) { progress ->
                                if (!indicator.isCanceled) {
                                    indicator.text = progress
                                }
                            }
                        }
                    }

                    val message = result.message.trim()
                    if (message.isEmpty()) {
                        Edt.later {
                            VibeflyNotifications.notify(
                                project,
                                VibeflyBundle.message("commit.generate.error.title"),
                                VibeflyBundle.message("commit.generate.error.empty"),
                                NotificationType.WARNING,
                            )
                        }
                        return
                    }

                    Edt.later {
                        commitMessage.setMessage(message)
                    }
                } catch (pce: ProcessCanceledException) {
                    throw pce
                } catch (ex: Exception) {
                    log.warn("generate commit message failed", ex)
                    val detail = ex.message?.takeIf { it.isNotBlank() }
                        ?: VibeflyBundle.message("commit.generate.error.unknown")
                    Edt.later {
                        VibeflyNotifications.notify(
                            project,
                            VibeflyBundle.message("commit.generate.error.title"),
                            detail,
                            NotificationType.ERROR,
                        )
                    }
                } finally {
                    generating.set(false)
                }
            }

            override fun onCancel() {
                generating.set(false)
            }

            override fun onThrowable(error: Throwable) {
                generating.set(false)
                super.onThrowable(error)
            }
        })
    }

    companion object {
        private val log get() = commitMessageLog
    }
}

internal fun resolveIncludedChanges(e: AnActionEvent, project: Project): Collection<Change> {
    val workflowUi: CommitWorkflowUi? = e.getData(VcsDataKeys.COMMIT_WORKFLOW_UI)
    if (workflowUi != null) {
        val included = workflowUi.getIncludedChanges()
        val unversioned = workflowUi.getIncludedUnversionedFiles()
        if (included.isEmpty() && unversioned.isEmpty()) {
            return emptyList()
        }
        if (unversioned.isEmpty()) {
            return included
        }
        val result = ArrayList<Change>(included.size + unversioned.size)
        result.addAll(included)
        for (filePath in unversioned) {
            result.add(unversionedAsAddedChange(filePath))
        }
        return result
    }
    return ChangeListManager.getInstance(project).defaultChangeList.changes
}

internal fun unversionedAsAddedChange(filePath: FilePath): Change =
    Change(null, CurrentContentRevision.create(filePath))

internal fun resolveCommitMessageWriter(e: AnActionEvent): CommitMessageWriter? {
    e.getData(VcsDataKeys.COMMIT_MESSAGE_CONTROL)?.let {
        return CommitMessageWriter.FromCommitMessageI(it)
    }
    val workflowUi: CommitWorkflowUi? = e.getData(VcsDataKeys.COMMIT_WORKFLOW_UI)
    workflowUi?.commitMessageUi?.let {
        return CommitMessageWriter.FromCommitMessageUi(it)
    }
    return null
}

/**
 * Runs [block] until completion, or cancels it when [indicator] is cancelled.
 * Cancellation propagates to SimpleRpc so the remote call is aborted.
 */
internal suspend fun <T> awaitWithProgressCancel(
    indicator: ProgressIndicator,
    block: suspend () -> T,
): T = coroutineScope {
    val work = async { block() }
    val cancelWatch = launch {
        while (isActive) {
            if (indicator.isCanceled) {
                commitMessageLog.info(
                    "generate commit message: progress cancelled, cancelling remote RPC",
                )
                work.cancel(CancellationException("Progress cancelled"))
                return@launch
            }
            delay(PROGRESS_CANCEL_POLL_MS.milliseconds)
        }
    }
    try {
        work.await()
    } catch (e: CancellationException) {
        if (indicator.isCanceled) {
            commitMessageLog.info("generate commit message: remote cancel completed")
            throw ProcessCanceledException(e)
        }
        throw e
    } finally {
        cancelWatch.cancel()
    }
}

private const val PROGRESS_CANCEL_POLL_MS = 50L

private val commitMessageLog = logger<GenerateCommitMessageAction>()

internal sealed interface CommitMessageWriter {
    fun setMessage(text: String)

    class FromCommitMessageI(private val control: CommitMessageI) : CommitMessageWriter {
        override fun setMessage(text: String) {
            control.setCommitMessage(text)
        }
    }

    class FromCommitMessageUi(private val ui: CommitMessageUi) : CommitMessageWriter {
        override fun setMessage(text: String) {
            ui.text = text
        }
    }
}
