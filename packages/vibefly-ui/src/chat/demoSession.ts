import type {ChatSessionSnapshot} from "@vibefly/uiagent-shared"

export function createDemoTab(): ChatSessionSnapshot {
    const timestamp = Date.now()
    return {
        summary: {
            sessionId: "demo-session",
            title: "GenerateCommitMessageAction 取消时远端未取消",
            state: "completed",
            unread: false,
            modelId: "local-grok/grok-4.5",
            thinkingLevel: "high",
            updatedAt: timestamp,
            messageCount: 3,
        },
        messages: [
            {
                id: "demo-user",
                role: "user",
                status: "complete",
                createdAt: timestamp - 80_000,
                parts: [
                    {
                        kind: "text",
                        text: "取消生成提交信息时，远端 RPC 仍在继续。请补充 host 和 agent 两侧的取消日志，并确保 AbortError 能正确结束流。",
                    },
                ],
            },
            {
                id: "demo-assistant",
                role: "assistant",
                status: "complete",
                createdAt: timestamp - 60_000,
                parts: [
                    {
                        kind: "thinking",
                        text: "The companion object reference is a bit awkward. I will keep one logger for the action and add a package logger for the cancellation helper. Then I will cover the stream abort path.",
                    },
                    {
                        kind: "text",
                        text: "Cleaning up the cancellation path and the duplicate logger setup.",
                    },
                    {
                        kind: "tool",
                        toolCallId: "demo-tool-1",
                        name: "edit",
                        status: "completed",
                        input: {path: "plugin/src/main/kotlin/.../GenerateCommitMessageAction.kt"},
                        output: "+8  -2",
                        locations: [
                            {
                                path: "plugin/src/main/kotlin/com/github/sandogeek/jetbrainsvibefly/commit/GenerateCommitMessageAction.kt",
                            },
                        ],
                    },
                    {
                        kind: "tool",
                        toolCallId: "demo-tool-2",
                        name: "edit",
                        status: "completed",
                        input: {path: "packages/vibefly-agent/src/commitMessage.ts"},
                        output: "+5  -1",
                        locations: [{path: "packages/vibefly-agent/src/commitMessage.ts"}],
                    },
                    {
                        kind: "thinking",
                        text: "The main remote-cancel path also needs an abort listener before the stream begins, otherwise cancellation can arrive before the loop observes the signal.",
                    },
                    {
                        kind: "text",
                        text: "The host now records cancellation before propagating it, and the Agent records both the abort receipt and the final aborted stream. The active request is released as soon as cancellation arrives.",
                    },
                ],
            },
        ],
    }
}
