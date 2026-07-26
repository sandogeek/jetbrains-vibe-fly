import type { JSX } from "solid-js"
import { createSignal, Show } from "solid-js"
import type { ProviderSnapshot } from "../generated/rpc"
import {
  credentialStatusText,
  formatModelsText,
  parseModelsText,
  validateProviderId,
} from "./providerLogic"
import { displayName } from "./providerLabels"

export type ConnectResult =
  | { kind: "cancel" }
  | { kind: "login" }
  | { kind: "apiKey"; apiKey: string }

export type CustomResult =
  | { kind: "cancel" }
  | {
      kind: "save"
      id: string
      baseUrl: string
      api: string
      modelsText: string
      apiKey: string
    }

export type LoginOverlayState = {
  providerName: string
  progress: string
  url: string | null
  launchUrl: string | null
  inputPrompt: string | null
  inputPlaceholder: string | null
  resolveInput?: (value: { text: string; cancelled: boolean }) => void
}

type ConnectDialogProps = {
  snapshot: ProviderSnapshot
  editMode: boolean
  onClose: (result: ConnectResult) => void
}

export function ConnectDialog(props: ConnectDialogProps) {
  const [apiKey, setApiKey] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const name = () => displayName(props.snapshot.id)

  const submitKey = () => {
    const key = apiKey().trim()
    if (!props.editMode && !key && !props.snapshot.supportsLogin) {
      setError("API key is required to connect")
      return
    }
    if (!props.editMode && !key && props.snapshot.supportsLogin) {
      setError("Enter an API key, or use Login")
      return
    }
    props.onClose({ kind: "apiKey", apiKey: key })
  }

  return (
    <ModalShell
      title={props.editMode ? `Edit ${name()}` : `Connect ${name()}`}
      onCancel={() => props.onClose({ kind: "cancel" })}
    >
      <Show when={props.snapshot.supportsLogin}>
        <p class="m-0 mb-3 text-xs text-muted">
          Prefer Login for browser OAuth or provider paste-key flows. You can still save an API key
          manually below.
        </p>
      </Show>
      <label class="mb-1 block text-xs text-muted">API key</label>
      <input
        type="password"
        class="mb-2 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg"
        value={apiKey()}
        onInput={(e) => setApiKey(e.currentTarget.value)}
        placeholder="Leave empty to keep the existing key"
      />
      <p class="m-0 mb-3 text-[11px] text-muted">{credentialStatusText(props.snapshot)}</p>
      <Show when={error()}>{(e) => <p class="m-0 mb-2 text-xs text-red-400">{e()}</p>}</Show>
      <div class="flex flex-wrap justify-end gap-2">
        <Show when={props.snapshot.supportsLogin && !props.editMode}>
          <button
            type="button"
            class="rounded border border-border px-3 py-1.5 text-sm text-fg hover:border-accent"
            onClick={() => props.onClose({ kind: "login" })}
          >
            Login
          </button>
        </Show>
        <button
          type="button"
          class="rounded border border-border px-3 py-1.5 text-sm text-muted"
          onClick={() => props.onClose({ kind: "cancel" })}
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded bg-accent px-3 py-1.5 text-sm text-bg"
          onClick={submitKey}
        >
          OK
        </button>
      </div>
    </ModalShell>
  )
}

type CustomDialogProps = {
  existing: ProviderSnapshot | null
  catalogIds: Set<string>
  existingCustomIds: Set<string>
  onClose: (result: CustomResult) => void
}

export function CustomProviderDialog(props: CustomDialogProps) {
  const isEdit = () => props.existing != null
  const [id, setId] = createSignal(props.existing?.id ?? "")
  const [baseUrl, setBaseUrl] = createSignal(props.existing?.baseUrl ?? "")
  const [api, setApi] = createSignal(props.existing?.api ?? "openai-completions")
  const [modelsText, setModelsText] = createSignal(
    props.existing?.models ? formatModelsText(props.existing.models) : "",
  )
  const [apiKey, setApiKey] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)

  const submit = () => {
    const err = validateProviderId(id(), props.catalogIds, props.existingCustomIds, isEdit())
    if (err) {
      setError(err)
      return
    }
    props.onClose({
      kind: "save",
      id: id().trim(),
      baseUrl: baseUrl().trim(),
      api: api().trim(),
      modelsText: modelsText(),
      apiKey: apiKey().trim(),
    })
  }

  return (
    <ModalShell
      title={isEdit() ? `Edit ${props.existing!.id}` : "Add Custom Provider"}
      onCancel={() => props.onClose({ kind: "cancel" })}
    >
      <Field label="Provider id">
        <input
          class="w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-sm text-fg disabled:opacity-60"
          value={id()}
          disabled={isEdit()}
          onInput={(e) => setId(e.currentTarget.value)}
        />
      </Field>
      <Field label="Base URL">
        <input
          class="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg"
          value={baseUrl()}
          onInput={(e) => setBaseUrl(e.currentTarget.value)}
          placeholder="https://api.example.com/v1"
        />
      </Field>
      <Field label="API">
        <select
          class="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg"
          value={api()}
          onChange={(e) => setApi(e.currentTarget.value)}
        >
          <option value="openai-completions">openai-completions</option>
          <option value="openai-responses">openai-responses</option>
          <option value="anthropic-messages">anthropic-messages</option>
          <option value="google-generative-ai">google-generative-ai</option>
        </select>
      </Field>
      <Field label="Models (one per line: id | name | api)">
        <textarea
          class="h-28 w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-xs text-fg"
          value={modelsText()}
          onInput={(e) => setModelsText(e.currentTarget.value)}
        />
      </Field>
      <Field label="API key">
        <input
          type="password"
          class="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg"
          value={apiKey()}
          onInput={(e) => setApiKey(e.currentTarget.value)}
          placeholder="Leave empty to keep the existing key"
        />
      </Field>
      <Show when={error()}>{(e) => <p class="m-0 mb-2 text-xs text-red-400">{e()}</p>}</Show>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded border border-border px-3 py-1.5 text-sm text-muted"
          onClick={() => props.onClose({ kind: "cancel" })}
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded bg-accent px-3 py-1.5 text-sm text-bg"
          onClick={submit}
        >
          Save
        </button>
      </div>
    </ModalShell>
  )
}

type LoginOverlayProps = {
  state: LoginOverlayState
  onOpenBrowser: () => void
  onCancel: () => void
  onSubmitInput: (text: string) => void
  onCancelInput: () => void
}

export function LoginOverlay(props: LoginOverlayProps) {
  const [input, setInput] = createSignal("")
  return (
    <ModalShell title={`Login to ${props.state.providerName}`} onCancel={props.onCancel}>
      <p class="m-0 mb-2 text-sm text-fg">{props.state.progress || "Working…"}</p>
      <Show when={props.state.url || props.state.launchUrl}>
        <div class="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded bg-accent px-3 py-1.5 text-sm text-bg"
            onClick={props.onOpenBrowser}
          >
            Open browser
          </button>
          <p class="m-0 self-center text-xs text-muted">
            Complete sign-in in the browser, then return here.
          </p>
        </div>
      </Show>
      <Show when={props.state.inputPrompt != null}>
        <div class="mb-3">
          <p class="m-0 mb-1 text-sm text-fg">{props.state.inputPrompt}</p>
          <input
            class="mb-2 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg"
            placeholder={props.state.inputPlaceholder ?? ""}
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
          />
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="rounded border border-border px-3 py-1.5 text-sm text-muted"
              onClick={props.onCancelInput}
            >
              Cancel
            </button>
            <button
              type="button"
              class="rounded bg-accent px-3 py-1.5 text-sm text-bg"
              onClick={() => props.onSubmitInput(input())}
            >
              Submit
            </button>
          </div>
        </div>
      </Show>
      <div class="flex justify-end">
        <button
          type="button"
          class="rounded border border-border px-3 py-1.5 text-sm text-muted"
          onClick={props.onCancel}
        >
          Cancel login
        </button>
      </div>
    </ModalShell>
  )
}

function ModalShell(props: {
  title: string
  onCancel: () => void
  children: JSX.Element
}) {
  return (
    <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div class="absolute inset-0" onClick={props.onCancel} />
      <div class="relative z-10 w-full max-w-md rounded-lg border border-border bg-bg p-4 shadow-xl">
        <h3 class="m-0 mb-3 text-base font-semibold text-fg">{props.title}</h3>
        {props.children}
      </div>
    </div>
  )
}

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <div class="mb-3">
      <label class="mb-1 block text-xs text-muted">{props.label}</label>
      {props.children}
    </div>
  )
}

export { parseModelsText }
