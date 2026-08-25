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
                        startedAt: timestamp - 60_000,
                        endedAt: timestamp - 55_400,
                    },
                    {
                        kind: "text",
                        text: "Cleaning up the cancellation path and the duplicate logger setup.",
                    },
                    {
                        kind: "tool",
                        toolCallId: "demo-tool-read",
                        name: "read",
                        status: "completed",
                        input: {
                            path: "plugin/src/main/kotlin/com/github/sandogeek/jetbrainsvibefly/commit/GenerateCommitMessageAction.kt",
                            offset: 40,
                            limit: 8,
                        },
                        output: [
                            "override fun actionPerformed(event: AnActionEvent) {",
                            "    val project = event.project ?: return",
                            "    val request = host.beginGenerate(project)",
                            "    try {",
                            "        request.stream()",
                            "    } catch (error: CancellationException) {",
                            "        log.warn(\"host cancelled generate-commit\")",
                            "        throw error",
                            "    }",
                            "}",
                        ].join("\n"),
                        locations: [
                            {
                                path: "plugin/src/main/kotlin/com/github/sandogeek/jetbrainsvibefly/commit/GenerateCommitMessageAction.kt",
                                line: 40,
                            },
                        ],
                    },
                    {
                        kind: "tool",
                        toolCallId: "demo-tool-write",
                        name: "write",
                        status: "completed",
                        input: {
                            path: "packages/vibefly-agent/src/cancelLog.ts",
                            content: "export function logCancel(reason: string): void {\n    log.warn(\"agent aborted\", {reason})\n}\n",
                        },
                        output: "Successfully wrote 78 bytes to packages/vibefly-agent/src/cancelLog.ts",
                        locations: [{path: "packages/vibefly-agent/src/cancelLog.ts"}],
                    },
                    {
                        kind: "tool",
                        toolCallId: "demo-tool-edit",
                        name: "edit",
                        status: "completed",
                        input: {
                            path: "packages/vibefly-agent/src/commitMessage.ts",
                            edits: [
                                {
                                    oldText: "const logger = createLogger(\"commit\")",
                                    newText: "const logger = createLogger(\"commit\")\nconst cancelLog = createLogger(\"commit-cancel\")",
                                },
                                {
                                    oldText: "stream.on(\"abort\", () => undefined)",
                                    newText: "stream.on(\"abort\", (reason) => cancelLog.warn(reason))",
                                },
                            ],
                        },
                        output: "Successfully edited packages/vibefly-agent/src/commitMessage.ts",
                        locations: [{path: "packages/vibefly-agent/src/commitMessage.ts"}],
                    },
                    {
                        kind: "thinking",
                        text: "The main remote-cancel path also needs an abort listener before the stream begins, otherwise cancellation can arrive before the loop observes the signal.",
                        startedAt: timestamp - 30_000,
                        endedAt: timestamp - 28_750,
                    },
                    {
                        kind: "tool",
                        toolCallId: "demo-tool-bash",
                        name: "bash",
                        status: "completed",
                        input: {command: "pnpm test"},
                        output: "\u001b[32mok\u001b[0m  presentRead\n\u001b[32mok\u001b[0m  presentDiff\n\n[exit code: 0]",
                    },
                    {
                        kind: "tool",
                        toolCallId: "demo-tool-grep",
                        name: "grep",
                        status: "completed",
                        input: {pattern: "abort", glob: "*.ts"},
                        output: [
                            "packages/vibefly-agent/src/commitMessage.ts:40: stream.on(\"abort\", (reason) => cancelLog.warn(reason))",
                            "packages/vibefly-agent/src/ws.ts:12: if (signal.aborted) return",
                            "packages/vibefly-agent/src/ws.ts:88: controller.abort()",
                        ].join("\n"),
                    },
                    {
                        kind: "tool",
                        toolCallId: "demo-tool-find",
                        name: "find",
                        status: "completed",
                        input: {pattern: "**/*cancel*"},
                        output: "packages/vibefly-agent/src/cancelLog.ts\nplugin/src/main/kotlin/com/github/sandogeek/jetbrainsvibefly/commit/GenerateCommitMessageAction.kt",
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
