/**
 * Regression: agent process stdout during boot + control RPC must be
 * parseable as SimpleRpc Content-Length frames only (no log noise).
 */
import {type ChildProcessWithoutNullStreams, spawn} from "node:child_process"
import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {describe, test} from "node:test"
import {expect} from "expect"
import {ContentLengthDecoder, createStdioSimpleRpc,} from "@sandogeek/simple-rpc-node"
import {agent2Host, host2Agent} from "./generated/controlRpc.js"

const srcDir = dirname(fileURLToPath(import.meta.url))
const mainTs = join(srcDir, "main.ts")
const READY_RE = /agent ready/
const BOOT_TIMEOUT_MS = 60_000

function waitForReady(
    child: ChildProcessWithoutNullStreams,
    stderrBuf: { text: string },
): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false
        const finish = (fn: () => void) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            child.stderr.off("data", onData)
            child.off("error", onError)
            child.off("exit", onExit)
            fn()
        }

        const timer = setTimeout(() => {
            finish(() => {
                reject(
                    new Error(
                        `agent did not become ready within ${BOOT_TIMEOUT_MS}ms\nstderr:\n${stderrBuf.text}`,
                    ),
                )
            })
        }, BOOT_TIMEOUT_MS)

        const onData = (chunk: Buffer) => {
            stderrBuf.text += chunk.toString("utf8")
            if (READY_RE.test(stderrBuf.text)) {
                finish(() => resolve())
            }
        }
        const onError = (err: Error) => {
            finish(() => reject(err))
        }
        const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
            finish(() => {
                reject(
                    new Error(
                        `agent exited before ready (code=${code}, signal=${signal})\nstderr:\n${stderrBuf.text}`,
                    ),
                )
            })
        }

        child.stderr.on("data", onData)
        child.on("error", onError)
        child.on("exit", onExit)
    })
}

function assertStdoutIsFrames(stdout: Buffer, label: string): void {
    const decoder = new ContentLengthDecoder()
    try {
        decoder.push(stdout)
        decoder.end()
    } catch (err) {
        const preview = stdout.subarray(0, 400).toString("utf8")
        throw new Error(
            `${label}: stdout is not valid Content-Length framing: ${String(err)}\npreview:\n${preview}`,
        )
    }
}

describe("agent stdout protocol isolation", () => {
    test(
        "startup settings RPC and control RPC stdout are Content-Length only",
        {timeout: BOOT_TIMEOUT_MS + 15_000},
        async () => {
            const agentDir = mkdtempSync(join(tmpdir(), "vibefly-agent-stdout-"))
            const child = spawn(process.execPath, ["--import", "tsx", mainTs], {
                cwd: join(srcDir, ".."),
                env: {
                    ...process.env,
                    VIBEFLY_LOG_LEVEL: "info",
                    PI_CODING_AGENT_DIR: agentDir,
                    // Avoid inheriting inspect flags that could print to stdout.
                    NODE_OPTIONS: undefined,
                },
                stdio: ["pipe", "pipe", "pipe"],
            })

            const stdoutChunks: Buffer[] = []
            const stderrBuf = {text: ""}
            child.stdout.on("data", (chunk: Buffer) => {
                stdoutChunks.push(Buffer.from(chunk))
            })
            // Keep collecting stderr after ready for debugging failures.
            child.stderr.on("data", (chunk: Buffer) => {
                if (!READY_RE.test(stderrBuf.text)) return
                stderrBuf.text += chunk.toString("utf8")
            })

            const peer = createStdioSimpleRpc({
                input: child.stdout,
                output: child.stdin,
            })
            agent2Host.register(peer, {
                openLoginUrl() {
                },
                requestLoginInput() {
                    return {cancelled: true}
                },
                reportLoginProgress() {
                },
                reportCommitMessageProgress() {
                },
                getSettingsSnapshot(scope: string) {
                    if (scope === "project") {
                        return {
                            scope,
                            projectRoot: "/workspace/project",
                            revisions: {
                                "settings.json": "project-1",
                                "settings.vibefly.json": "project-1",
                            } as Record<string, string>,
                        }
                    }
                    return {
                        scope: "application",
                        projectRoot: null,
                        modelsJson: "{}",
                        authJson: "{}",
                        revisions: {
                            "settings.json": "application-1",
                            "settings.vibefly.json": "application-1",
                            "models.json": "application-1",
                            "auth.json": "application-1",
                        },
                    }
                },
                saveAuth() {
                    return {ok: true, revision: "application-2"}
                },
                saveSettingsDocuments() {
                    return {ok: true, revision: "application-2"}
                },
            })

            try {
                await waitForReady(child, stderrBuf)

                const bootStdout = Buffer.concat(stdoutChunks)
                expect(bootStdout.byteLength).toBeGreaterThan(0)
                assertStdoutIsFrames(bootStdout, "boot")

                const host = host2Agent.createProxy(peer)

                const conn = await host.openWebSocketSession("http://localhost")
                expect(typeof conn.url).toBe("string")
                expect(conn.url.length).toBeGreaterThan(0)
                expect(typeof conn.ticket).toBe("string")
                expect(conn.ticket.length).toBeGreaterThan(0)

                // Agent process.exit()s inside shutdown before writing a reply; do not await.
                void host.shutdown().catch(() => {
                })

                const exitCode = await new Promise<number | null>((resolve) => {
                    if (child.exitCode != null) {
                        resolve(child.exitCode)
                        return
                    }
                    const t = setTimeout(() => {
                        child.kill("SIGKILL")
                        resolve(null)
                    }, 10_000)
                    child.once("exit", (code) => {
                        clearTimeout(t)
                        resolve(code)
                    })
                })
                expect(exitCode).toBe(0)

                // Drain remaining stdout after process exit.
                await new Promise((r) => setTimeout(r, 50))
                const allStdout = Buffer.concat(stdoutChunks)
                expect(allStdout.byteLength).toBeGreaterThan(0)
                assertStdoutIsFrames(allStdout, "full session")

                try {
                    peer.close()
                } catch {
                    // peer already closed when child stdout ended
                }
            } finally {
                if (!child.killed && child.exitCode == null) {
                    child.kill("SIGKILL")
                }
                rmSync(agentDir, {recursive: true, force: true})
            }
        },
    )
})
