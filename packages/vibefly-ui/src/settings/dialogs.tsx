import type { JSX } from "solid-js"
import { createSignal, Show } from "solid-js"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  TextField,
  TextFieldInput,
  TextFieldLabel,
  TextFieldTextArea,
} from "@/components/ui/text-field"
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
        <DialogDescription class="mb-3 text-xs">{t("dialogs.loginHint")}</DialogDescription>
      </Show>
      <TextField class="mb-2" value={apiKey()} onChange={setApiKey}>
        <TextFieldLabel>{t("dialogs.apiKey")}</TextFieldLabel>
        <TextFieldInput type="password" placeholder={t("dialogs.keepExistingKey")} />
      </TextField>
      <p class="m-0 mb-3 text-[11px] text-muted">{credentialStatusText(props.snapshot, labels())}</p>
      <Show when={error()}>{(e) => <p class="m-0 mb-2 text-xs text-destructive">{e()}</p>}</Show>
      <DialogFooter>
        <Show when={props.snapshot.supportsLogin && !props.editMode}>
          <Button variant="outline" onClick={() => props.onClose({ kind: "login" })}>
            {t("common.login")}
          </Button>
        </Show>
        <Button variant="outline" onClick={() => props.onClose({ kind: "cancel" })}>
          {t("common.cancel")}
        </Button>
        <Button onClick={submitKey}>{t("common.ok")}</Button>
      </DialogFooter>
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
      <TextField value={id()} onChange={setId} disabled={isEdit()}>
        <TextFieldLabel>{t("dialogs.providerId")}</TextFieldLabel>
        <TextFieldInput class="font-mono" />
      </TextField>
      <TextField value={baseUrl()} onChange={setBaseUrl}>
        <TextFieldLabel>{t("dialogs.baseUrl")}</TextFieldLabel>
        <TextFieldInput placeholder="https://api.example.com/v1" />
      </TextField>
      <div class="mb-3">
        <label class="mb-1 block text-xs text-muted">{t("dialogs.api")}</label>
        <select
          class="flex h-9 w-full rounded-md border border-input bg-surface px-2 py-1.5 text-sm text-fg"
          value={api()}
          onChange={(e) => setApi(e.currentTarget.value)}
        >
          <option value="openai-completions">openai-completions</option>
          <option value="openai-responses">openai-responses</option>
          <option value="anthropic-messages">anthropic-messages</option>
          <option value="google-generative-ai">google-generative-ai</option>
        </select>
      </div>
      <TextField value={modelsText()} onChange={setModelsText}>
        <TextFieldLabel>{t("dialogs.modelsLine")}</TextFieldLabel>
        <TextFieldTextArea class="h-28" />
      </TextField>
      <TextField value={apiKey()} onChange={setApiKey}>
        <TextFieldLabel>{t("dialogs.apiKey")}</TextFieldLabel>
        <TextFieldInput type="password" placeholder={t("dialogs.keepExistingKey")} />
      </TextField>
      <Show when={error()}>{(e) => <p class="m-0 mb-2 text-xs text-destructive">{e()}</p>}</Show>
      <DialogFooter>
        <Button variant="outline" onClick={() => props.onClose({ kind: "cancel" })}>
          {t("common.cancel")}
        </Button>
        <Button onClick={submit}>{t("common.save")}</Button>
      </DialogFooter>
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
          <Button onClick={props.onOpenBrowser}>{t("dialogs.openBrowser")}</Button>
          <p class="m-0 self-center text-xs text-muted">{t("dialogs.completeSignIn")}</p>
        </div>
      </Show>
      <Show when={props.state.inputPrompt != null}>
        <div class="mb-3">
          <p class="m-0 mb-1 text-sm text-fg">{props.state.inputPrompt}</p>
          <TextField class="mb-2" value={input()} onChange={setInput}>
            <TextFieldInput placeholder={props.state.inputPlaceholder ?? ""} />
          </TextField>
          <DialogFooter>
            <Button variant="outline" onClick={props.onCancelInput}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => props.onSubmitInput(input())}>{t("common.submit")}</Button>
          </DialogFooter>
        </div>
      </Show>
      <DialogFooter>
        <Button variant="outline" onClick={props.onCancel}>
          {t("dialogs.cancelLogin")}
        </Button>
      </DialogFooter>
    </ModalShell>
  )
}

function ModalShell(props: {
  title: string
  onCancel: () => void
  children: JSX.Element
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        {props.children}
      </DialogContent>
    </Dialog>
  )
}

export { parseModelsText }
