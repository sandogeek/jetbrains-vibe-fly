package com.github.sandogeek.jetbrainsvibefly.chat

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Queues tool-window title-bar commands until the JCEF page has installed its reverse-RPC consumer. */
@Service(Service.Level.PROJECT)
class ChatToolWindowCommandService : Disposable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutex = Mutex()
    private val pendingNewSessions = ArrayDeque<Unit>()

    @Volatile
    private var createNewSession: (suspend () -> Unit)? = null

    fun bind(createNewSession: suspend () -> Unit) {
        this.createNewSession = createNewSession
        scope.launch { flush() }
    }

    fun requestNewSession() {
        scope.launch {
            mutex.withLock { pendingNewSessions.addLast(Unit) }
            flush()
        }
    }

    fun retry() {
        scope.launch { flush() }
    }

    private suspend fun flush() {
        val target = createNewSession ?: return
        while (true) {
            mutex.withLock { pendingNewSessions.removeFirstOrNull() } ?: return
            try {
                target()
            } catch (_: Exception) {
                mutex.withLock { pendingNewSessions.addFirst(Unit) }
                return
            }
        }
    }

    override fun dispose() {
        createNewSession = null
        scope.cancel()
    }

    companion object {
        fun getInstance(project: Project): ChatToolWindowCommandService =
            project.getService(ChatToolWindowCommandService::class.java)
    }
}
