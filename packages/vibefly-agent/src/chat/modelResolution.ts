import type {AgentSession} from "@earendil-works/pi-coding-agent"
import type {Api, Model} from "@earendil-works/pi-ai"
import type {ChatModelOption} from "@vibefly/uiagent-shared"

export const THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "auto",
])

export function modelKey(model: Pick<Model<Api>, "provider" | "id">): string {
  return `${model.provider}/${model.id}`
}

export function toModelOption(model: Model<Api>): ChatModelOption {
  return {
    id: modelKey(model),
    provider: model.provider,
    model: model.id,
    label: model.name || model.id,
    supportsThinking: Boolean(model.reasoning),
  }
}

export function resolveModel(
  registry: {find(provider: string, id: string): Model<Api> | undefined},
  modelId: string | undefined,
): Model<Api> | undefined {
  const spec = modelId?.trim()
  if (!spec) return undefined
  const slash = spec.indexOf("/")
  if (slash <= 0 || slash === spec.length - 1) return undefined
  return registry.find(spec.slice(0, slash), spec.slice(slash + 1))
}

export function refreshSessionModelFromRuntime(
  session: Pick<
    AgentSession,
    "model" | "modelRuntime" | "setThinkingLevel" | "state" | "thinkingLevel"
  >,
): void {
  const current = session.model
  if (!current) return
  const refreshed = session.modelRuntime.getModel(current.provider, current.id)
  if (!refreshed || refreshed === current) return
  session.state.model = refreshed
  session.setThinkingLevel(session.thinkingLevel)
}
