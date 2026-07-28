package com.github.sandogeek.jetbrainsvibefly.chat

import com.github.sandogeek.vibefly.jcef.rpc.HostChatContextItem
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

/** Queues editor/drag contexts until the JCEF page has installed its reverse-RPC consumer. */
@Service(Service.Level.PROJECT)
class ChatContextDeliveryService(private val project: Project) : Disposable {
    private data class Pending(val sessionId: String, val contexts: List<HostChatContextItem>)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutex = Mutex()
    private val pending = ArrayDeque<Pending>()

    @Volatile
    private var consumer: (suspend (String, List<HostChatContextItem>) -> Unit)? = null

    fun bind(consumer: suspend (String, List<HostChatContextItem>) -> Unit) {
        this.consumer = consumer
        scope.launch { flush() }
    }

    fun offer(contexts: List<HostChatContextItem>) {
        if (contexts.isEmpty()) return
        val sessionId = ChatWorkspaceState.getInstance(project).activeSessionId
        if (sessionId.isBlank()) return
        scope.launch {
            mutex.withLock { pending.addLast(Pending(sessionId, contexts)) }
            flush()
        }
    }

    fun retry() {
        scope.launch { flush() }
    }

    private suspend fun flush() {
        val target = consumer ?: return
        while (true) {
            val item = mutex.withLock { pending.removeFirstOrNull() } ?: return
            try {
                target(item.sessionId, item.contexts)
            } catch (_: Exception) {
                mutex.withLock { pending.addFirst(item) }
                return
            }
        }
    }

    override fun dispose() {
        consumer = null
        scope.cancel()
    }

    companion object {
        fun getInstance(project: Project): ChatContextDeliveryService =
            project.getService(ChatContextDeliveryService::class.java)
    }
}
