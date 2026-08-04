import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TextField, TextFieldInput, TextFieldLabel, TextFieldTextArea } from "@/components/ui/text-field"
import type { ProviderSnapshot } from "./providerSnapshots"
import { useT, type Translator } from "../i18n"
import { credentialStatusText, formatModelsText, parseModelsText, validateProviderId, type ProviderUiLabels } from "./providerLogic"
import { displayName } from "./providerLabels"

export type ConnectResult = { kind: "cancel" } | { kind: "login" } | { kind: "apiKey"; apiKey: string }
export type CustomResult = { kind: "cancel" } | { kind: "save"; id: string; baseUrl: string; api: string; modelsText: string; apiKey: string }
export type LoginOverlayState = { providerName: string; progress: string; url: string | null; launchUrl: string | null; inputPrompt: string | null; inputPlaceholder: string | null; resolveInput?: (value: { text: string; cancelled: boolean }) => void }

export function providerUiLabels(t: Translator): ProviderUiLabels {
  return {
    badgeCustom: t("providers.badgeCustom"), badgeApiKey: t("providers.badgeApiKey"), badgeOauth: t("providers.badgeOauth"), badgeConfigured: t("providers.badgeConfigured"),
    credApiKeySet: (origin) => t("providers.credApiKeySet", { origin }), credNoApiKey: t("providers.credNoApiKey"), credOauthPresent: t("providers.credOauthPresent"), credLoginAvailable: t("providers.credLoginAvailable"),
    idRequired: t("providers.idRequired"), idCatalogConflict: t("providers.idCatalogConflict"), idCustomConflict: t("providers.idCustomConflict"), idInvalid: t("providers.idInvalid"),
  }
}

type ConnectDialogProps = { snapshot: ProviderSnapshot; editMode: boolean; onClose: (result: ConnectResult) => void }
export function ConnectDialog({ snapshot, editMode, onClose }: ConnectDialogProps) {
  const t = useT(); const labels = providerUiLabels(t); const [apiKey, setApiKey] = useState(""); const [error, setError] = useState<string | null>(null)
  const submitKey = () => { const key = apiKey.trim(); if (!editMode && !key && !snapshot.supportsLogin) return setError(t("dialogs.apiKeyRequired")); if (!editMode && !key && snapshot.supportsLogin) return setError(t("dialogs.apiKeyOrLogin")); onClose({ kind: "apiKey", apiKey: key }) }
  return <ModalShell title={editMode ? t("dialogs.editProvider", { name: displayName(snapshot.id) }) : t("dialogs.connectProvider", { name: displayName(snapshot.id) })} onCancel={() => onClose({ kind: "cancel" })}>
    {snapshot.supportsLogin && <DialogDescription className="mb-3 text-xs">{t("dialogs.loginHint")}</DialogDescription>}
    <TextField className="mb-2" value={apiKey} onChange={setApiKey}><TextFieldLabel>{t("dialogs.apiKey")}</TextFieldLabel><TextFieldInput type="password" placeholder={t("dialogs.keepExistingKey")} /></TextField>
    <p className="m-0 mb-3 text-[11px] text-muted">{credentialStatusText(snapshot, labels)}</p>
    {error && <p className="m-0 mb-2 text-xs text-destructive">{error}</p>}
    <DialogFooter>{snapshot.supportsLogin && !editMode && <Button variant="outline" onClick={() => onClose({ kind: "login" })}>{t("common.login")}</Button>}<Button variant="outline" onClick={() => onClose({ kind: "cancel" })}>{t("common.cancel")}</Button><Button onClick={submitKey}>{t("common.ok")}</Button></DialogFooter>
  </ModalShell>
}

type CustomDialogProps = { existing: ProviderSnapshot | null; catalogIds: Set<string>; existingCustomIds: Set<string>; onClose: (result: CustomResult) => void }
export function CustomProviderDialog({ existing, catalogIds, existingCustomIds, onClose }: CustomDialogProps) {
  const t = useT(); const isEdit = existing != null; const [id, setId] = useState(existing?.id ?? ""); const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? ""); const [api, setApi] = useState(existing?.api ?? "openai-completions"); const [modelsText, setModelsText] = useState(existing?.models ? formatModelsText(existing.models) : ""); const [apiKey, setApiKey] = useState(""); const [error, setError] = useState<string | null>(null)
  const submit = () => { const err = validateProviderId(id, catalogIds, existingCustomIds, isEdit, providerUiLabels(t)); if (err) return setError(err); onClose({ kind: "save", id: id.trim(), baseUrl: baseUrl.trim(), api: api.trim(), modelsText, apiKey: apiKey.trim() }) }
  return <ModalShell title={isEdit ? t("dialogs.editProvider", { name: existing!.id }) : t("dialogs.addCustomProvider")} onCancel={() => onClose({ kind: "cancel" })}>
    <TextField value={id} onChange={setId} disabled={isEdit}><TextFieldLabel>{t("dialogs.providerId")}</TextFieldLabel><TextFieldInput className="font-mono" /></TextField>
    <TextField value={baseUrl} onChange={setBaseUrl}><TextFieldLabel>{t("dialogs.baseUrl")}</TextFieldLabel><TextFieldInput placeholder="https://api.example.com/v1" /></TextField>
    <div className="mb-3"><label className="mb-1 block text-xs text-muted">{t("dialogs.api")}</label><select className="flex h-9 w-full rounded-md border border-input bg-surface px-2 py-1.5 text-sm text-fg" value={api} onChange={(event) => setApi(event.currentTarget.value)}><option value="openai-completions">openai-completions</option><option value="openai-responses">openai-responses</option><option value="anthropic-messages">anthropic-messages</option><option value="google-generative-ai">google-generative-ai</option></select></div>
    <TextField value={modelsText} onChange={setModelsText}><TextFieldLabel>{t("dialogs.modelsLine")}</TextFieldLabel><TextFieldTextArea className="h-28" /></TextField>
    <TextField value={apiKey} onChange={setApiKey}><TextFieldLabel>{t("dialogs.apiKey")}</TextFieldLabel><TextFieldInput type="password" placeholder={t("dialogs.keepExistingKey")} /></TextField>
    {error && <p className="m-0 mb-2 text-xs text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" onClick={() => onClose({ kind: "cancel" })}>{t("common.cancel")}</Button><Button onClick={submit}>{t("common.save")}</Button></DialogFooter>
  </ModalShell>
}

type LoginOverlayProps = { state: LoginOverlayState; onOpenBrowser: () => void; onCancel: () => void; onSubmitInput: (text: string) => void; onCancelInput: () => void }
export function LoginOverlay({ state, onOpenBrowser, onCancel, onSubmitInput, onCancelInput }: LoginOverlayProps) {
  const t = useT(); const [input, setInput] = useState("")
  return <ModalShell title={t("dialogs.loginTo", { name: state.providerName })} onCancel={onCancel}>
    <p className="m-0 mb-2 text-sm text-fg">{state.progress || t("common.working")}</p>
    {(state.url || state.launchUrl) && <div className="mb-3 flex flex-wrap gap-2"><Button onClick={onOpenBrowser}>{t("dialogs.openBrowser")}</Button><p className="m-0 self-center text-xs text-muted">{t("dialogs.completeSignIn")}</p></div>}
    {state.inputPrompt != null && <div className="mb-3"><p className="m-0 mb-1 text-sm text-fg">{state.inputPrompt}</p><TextField className="mb-2" value={input} onChange={setInput}><TextFieldInput placeholder={state.inputPlaceholder ?? ""} /></TextField><DialogFooter><Button variant="outline" onClick={onCancelInput}>{t("common.cancel")}</Button><Button onClick={() => onSubmitInput(input)}>{t("common.submit")}</Button></DialogFooter></div>}
    <DialogFooter><Button variant="outline" onClick={onCancel}>{t("dialogs.cancelLogin")}</Button></DialogFooter>
  </ModalShell>
}

function ModalShell({ title, onCancel, children }: { title: string; onCancel: () => void; children: ReactNode }) {
  return <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}><DialogContent showCloseButton={false}><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>{children}</DialogContent></Dialog>
}

export { parseModelsText }
