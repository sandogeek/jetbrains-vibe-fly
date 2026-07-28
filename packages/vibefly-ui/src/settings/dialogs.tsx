import type { JSX } from "solid-js"
import { createSignal, Show } from "solid-js"
import type { ProviderSnapshot } from "../generated/rpc"
import { useT, type Translator } from "../i18n"
import {
  credentialStatusText,
  formatModelsText,
  parseModelsText,
  validateProviderId,
  type ProviderUiLabels,
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

export function providerUiLabels(t: Translator): ProviderUiLabels {
  return {
    badgeCustom: t("providers.badgeCustom"),
    badgeApiKey: t("providers.badgeApiKey"),
    badgeOauth: t("providers.badgeOauth"),
    badgeConfigured: t("providers.badgeConfigured"),
    credApiKeySet: (origin) => t("providers.credApiKeySet", { origin }),
    credNoApiKey: t("providers.credNoApiKey"),
    credOauthPresent: t("providers.credOauthPresent"),
    credLoginAvailable: t("providers.credLoginAvailable"),
    idRequired: t("providers.idRequired"),
    idCatalogConflict: t("providers.idCatalogConflict"),
    idCustomConflict: t("providers.idCustomConflict"),
    idInvalid: t("providers.idInvalid"),
  }
}

type ConnectDialogProps = {
  snapshot: ProviderSnapshot
  editMode: boolean
  onClose: (result: ConnectResult) => void
}

export function ConnectDialog(props: ConnectDialogProps) {
  const t = useT()
  const labels = () => providerUiLabels(t)
  const [apiKey, setApiKey] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const name = () => displayName(props.snapshot.id)

  const submitKey = () => {
    const key = apiKey().trim()
    if (!props.editMode && !key && !props.snapshot.supportsLogin) {
      setError(t("dialogs.apiKeyRequired"))
      return
    }
    if (!props.editMode && !key && props.snapshot.supportsLogin) {
      setError(t("dialogs.apiKeyOrLogin"))
      return
    }
    props.onClose({ kind: "apiKey", apiKey: key })
  }

  return (
    <ModalShell
      title={
        props.editMode
          ? t("dialogs.editProvider", { name: name() })
          : t("dialogs.connectProvider", { name: name() })
      }
      onCancel={() => props.onClose({ kind: "cancel" })}
    >
      <Show when={props.snapshot.supportsLogin}>
        <p class="m-0 mb-3 text-xs text-muted">{t("dialogs.loginHint")}</p>
      </Show>
      <label class="mb-1 block text-xs text-muted">{t("dialogs.apiKey")}</label>
      <input
        type="password"
        class="mb-2 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg"
        value={apiKey()}
        onInput={(e) => setApiKey(e.currentTarget.value)}
        placeholder={t("dialogs.keepExistingKey")}
      />
      <p class="m-0 mb-3 text-[11px] text-muted">
        {credentialStatusText(props.snapshot, labels())}
      </p>
      <Show when={error()}>{(e) => <p class="m-0 mb-2 text-xs text-red-400">{e()}</p>}</Show>
      <div class="flex flex-wrap justify-end gap-2">
        <Show when={props.snapshot.supportsLogin && !props.editMode}>
          <button
            type="button"
            class="rounded border border-border px-3 py-1.5 text-sm text-fg hover:border-accent"
            onClick={() => props.onClose({ kind: "login" })}
          >
            {t("common.login")}
          </button>
        </Show>
        <button
          type="button"
          class="rounded border border-border px-3 py-1.5 text-sm text-muted"
          onClick={() => props.onClose({ kind: "cancel" })}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          class="rounded bg-accent px-3 py-1.5 text-sm text-bg"
          onClick={submitKey}
        >
          {t("common.ok")}
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
  const t = useT()
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
    const err = validateProviderId(
      id(),
      props.catalogIds,
      props.existingCustomIds,
      isEdit(),
      providerUiLabels(t),
    )
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
      title={
        isEdit()
          ? t("dialogs.editProvider", { name: props.existing!.id })
          : t("dialogs.addCustomProvider")
      }
      onCancel={() => props.onClose({ kind: "cancel" })}
    >
      <Field label={t("dialogs.providerId")}>
        <input
          class="w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-sm text-fg disabled:opacity-60"
          value={id()}
          disabled={isEdit()}
          onInput={(e) => setId(e.currentTarget.value)}
        />
      </Field>
      <Field label={t("dialogs.baseUrl")}>
        <input
          class="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg"
          value={baseUrl()}
          onInput={(e) => setBaseUrl(e.currentTarget.value)}
          placeholder="https://api.example.com/v1"
        />
      </Field>
      <Field label={t("dialogs.api")}>
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
      <Field label={t("dialogs.modelsLine")}>
        <textarea
          class="h-28 w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-xs text-fg"
          value={modelsText()}
          onInput={(e) => setModelsText(e.currentTarget.value)}
        />
      </Field>
      <Field label={t("dialogs.apiKey")}>
        <input
          type="password"
          class="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg"
          value={apiKey()}
          onInput={(e) => setApiKey(e.currentTarget.value)}
          placeholder={t("dialogs.keepExistingKey")}
        />
      </Field>
      <Show when={error()}>{(e) => <p class="m-0 mb-2 text-xs text-red-400">{e()}</p>}</Show>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded border border-border px-3 py-1.5 text-sm text-muted"
          onClick={() => props.onClose({ kind: "cancel" })}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          class="rounded bg-accent px-3 py-1.5 text-sm text-bg"
          onClick={submit}
        >
          {t("common.save")}
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
  const t = useT()
  const [input, setInput] = createSignal("")
  return (
    <ModalShell
      title={t("dialogs.loginTo", { name: props.state.providerName })}
      onCancel={props.onCancel}
    >
      <p class="m-0 mb-2 text-sm text-fg">{props.state.progress || t("common.working")}</p>
      <Show when={props.state.url || props.state.launchUrl}>
        <div class="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded bg-accent px-3 py-1.5 text-sm text-bg"
            onClick={props.onOpenBrowser}
          >
            {t("dialogs.openBrowser")}
          </button>
          <p class="m-0 self-center text-xs text-muted">{t("dialogs.completeSignIn")}</p>
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
              {t("common.cancel")}
            </button>
            <button
              type="button"
              class="rounded bg-accent px-3 py-1.5 text-sm text-bg"
              onClick={() => props.onSubmitInput(input())}
            >
              {t("common.submit")}
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
          {t("dialogs.cancelLogin")}
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
