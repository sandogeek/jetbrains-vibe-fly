/** Shared UI ↔ Agent DTO and event types (JSON-serializable). */

export type TaskId = string

export type StartTaskRequest = {
  prompt: string
  /** Optional workspace-relative path hints for the agent. */
  paths?: string[]
}

export type AgentEvent =
  | { kind: "log"; message: string }
  | { kind: "status"; status: string }
  | { kind: "taskDone"; taskId: TaskId; ok: boolean; message?: string }
