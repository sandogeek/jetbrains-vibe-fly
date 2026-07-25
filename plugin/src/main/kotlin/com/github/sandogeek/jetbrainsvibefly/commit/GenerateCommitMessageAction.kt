package com.github.sandogeek.jetbrainsvibefly.commit

import com.github.sandogeek.jetbrainsvibefly.VibeflyBundle
import com.github.sandogeek.jetbrainsvibefly.agent.VibeflyAgentService
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
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
import kotlinx.coroutines.runBlocking
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Commit message area action: generate Conventional Commits English message
 * from currently included/checked changes via Host2Agent + Bun pi-ai.
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
            notify(
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
            notify(
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
                        ApplicationManager.getApplication().invokeLater {
                            notify(
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

                    val agent = VibeflyAgentService.getInstance(project)
                    val result = runBlocking {
                        agent.generateCommitMessage(collected.toRequest())
                    }
                    if (indicator.isCanceled) throw ProcessCanceledException()

                    val message = result.message.trim()
                    if (message.isEmpty()) {
                        ApplicationManager.getApplication().invokeLater {
                            notify(
                                project,
                                VibeflyBundle.message("commit.generate.error.title"),
                                VibeflyBundle.message("commit.generate.error.empty"),
                                NotificationType.WARNING,
                            )
                        }
                        return
                    }

                    ApplicationManager.getApplication().invokeLater {
                        commitMessage.setMessage(message)
                    }
                } catch (pce: ProcessCanceledException) {
                    throw pce
                } catch (ex: Exception) {
                    log.warn("generate commit message failed", ex)
                    val detail = ex.message?.takeIf { it.isNotBlank() }
                        ?: VibeflyBundle.message("commit.generate.error.unknown")
                    ApplicationManager.getApplication().invokeLater {
                        notify(
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
        private val log = logger<GenerateCommitMessageAction>()

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

        private fun notify(
            project: Project,
            title: String,
            content: String,
            type: NotificationType,
        ) {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("Vibe Fly")
                .createNotification(title, content, type)
                .notify(project)
        }
    }

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
}
