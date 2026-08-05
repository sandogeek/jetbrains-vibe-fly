package com.github.sandogeek.vibefly.jcef.rpc

import com.github.sandogeek.simplerpc.annotation.KotlinCallTs
import com.github.sandogeek.simplerpc.annotation.RpcFun

/**
 * Chat-panel Host → UI methods (tool window only).
 * Wire service name: Host2UiChat.
 */
@KotlinCallTs
interface Host2UiChat {
    /** Native file chooser / drag-and-drop delivery into the currently active chat tab. */
    @RpcFun(1)
    suspend fun addChatContexts(sessionId: String, contexts: List<HostChatContextItem>)
}
