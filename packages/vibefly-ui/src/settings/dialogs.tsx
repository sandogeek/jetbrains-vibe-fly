import {type ReactNode, useMemo, useState} from "react"

import {Button} from "@/components/ui/button"
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog"
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select"
import {Switch} from "@/components/ui/switch"
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs"
import {TextField, TextFieldInput, TextFieldLabel, TextFieldTextArea} from "@/components/ui/text-field"
import type {ProviderSnapshot} from "./providerSnapshots"
import {
    API_PRESETS,
    draftFromConfigJson,
    draftToConfigJson,
    duplicateModel,
    emptyModelDraft,
    emptyProviderDraft,
    formatConfigJson,
    type ModelConfigDraft,
    type ProviderConfigDraft,
    validateConfigJson,
} from "./providerConfigDraft"
import {type Translator, useAppTranslation} from "../i18n"
import {credentialStatusText, type ProviderUiLabels, validateProviderId} from "./providerLogic"
import {displayName} from "./providerLabels"

export type ConnectResult = { kind: "cancel" } | { kind: "login" } | { kind: "apiKey"; apiKey: string }
export type CustomResult = { kind: "cancel" } | {
    kind: "save"
    id: string
    configJson: string
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
        badgeCustom: t("providers:badgeCustom"),
        badgeApiKey: t("providers:badgeApiKey"),
        badgeOauth: t("providers:badgeOauth"),
        badgeConfigured: t("providers:badgeConfigured"),
        credApiKeySet: (origin) => t("providers:credApiKeySet", {origin}),
        credNoApiKey: t("providers:credNoApiKey"),
        credOauthPresent: t("providers:credOauthPresent"),
        credLoginAvailable: t("providers:credLoginAvailable"),
        idRequired: t("providers:idRequired"),
        idCatalogConflict: t("providers:idCatalogConflict"),
        idCustomConflict: t("providers:idCustomConflict"),
        idInvalid: t("providers:idInvalid"),
    }
}

type ConnectDialogProps = { snapshot: ProviderSnapshot; editMode: boolean; onClose: (result: ConnectResult) => void }

export function ConnectDialog({snapshot, editMode, onClose}: ConnectDialogProps) {
    const {t} = useAppTranslation(["dialogs", "providers"]);
    const labels = providerUiLabels(t);
    const [apiKey, setApiKey] = useState("");
    const [error, setError] = useState<string | null>(null)
    const submitKey = () => {
        const key = apiKey.trim();
        if (!editMode && !key && !snapshot.supportsLogin) return setError(t("dialogs:apiKeyRequired"));
        if (!editMode && !key && snapshot.supportsLogin) return setError(t("dialogs:apiKeyOrLogin"));
        onClose({kind: "apiKey", apiKey: key})
    }
    return <ModalShell
        title={editMode ? t("dialogs:editProvider", {name: displayName(snapshot.id)}) : t("dialogs:connectProvider", {name: displayName(snapshot.id)})}
        onCancel={() => onClose({kind: "cancel"})}>
        {snapshot.supportsLogin &&
            <DialogDescription className="mb-3 text-xs">{t("dialogs:loginHint")}</DialogDescription>}
        {snapshot.credential?.hasOAuth &&
            <p className="m-0 mb-3 text-xs text-muted">{t("dialogs:disconnectBeforeApiKeyHint")}</p>}
        <TextField className="mb-2" value={apiKey}
                   onChange={setApiKey}><TextFieldLabel>{t("dialogs:apiKey")}</TextFieldLabel><TextFieldInput
            type="password" placeholder={t("dialogs:keepExistingKey")}/></TextField>
        <p className="m-0 mb-3 text-[11px] text-muted">{credentialStatusText(snapshot, labels)}</p>
        {error && <p className="m-0 mb-2 text-xs text-destructive">{error}</p>}
        <DialogFooter>{snapshot.supportsLogin && !editMode &&
            <Button variant="outline" onClick={() => onClose({kind: "login"})}>{t("common:login")}</Button>}<Button
            variant="outline" onClick={() => onClose({kind: "cancel"})}>{t("common:cancel")}</Button><Button
            onClick={submitKey}>{t("common:ok")}</Button></DialogFooter>
    </ModalShell>
}

type CustomDialogProps = {
    existing: ProviderSnapshot | null
    catalogIds: Set<string>
    existingCustomIds: Set<string>
    onClose: (result: CustomResult) => void
}

type EditorTab = "basic" | "advanced"

export function CustomProviderDialog({existing, catalogIds, existingCustomIds, onClose}: CustomDialogProps) {
    const {t} = useAppTranslation(["dialogs", "providers"])
    const isEdit = existing != null
    const initialDraft = useMemo(
        () => (existing?.configJson ? draftFromConfigJson(existing.configJson) : emptyProviderDraft()),
        [existing?.configJson],
    )
    const [id, setId] = useState(existing?.id ?? "")
    const [draft, setDraft] = useState<ProviderConfigDraft>(initialDraft)
    const [jsonText, setJsonText] = useState(() => formatConfigJson(existing?.configJson ?? draftToConfigJson(initialDraft)))
    const [jsonDirty, setJsonDirty] = useState(false)
    const [tab, setTab] = useState<EditorTab>("basic")
    const [apiKey, setApiKey] = useState("")
    const [error, setError] = useState<string | null>(null)

    const syncJsonFromDraft = (next: ProviderConfigDraft) => {
        setDraft(next)
        if (!jsonDirty) setJsonText(draftToConfigJson(next))
    }

    const switchTab = (next: EditorTab) => {
        if (next === tab) return
        if (next === "advanced") {
            if (!jsonDirty) setJsonText(draftToConfigJson(draft))
            setTab("advanced")
            return
        }
        // advanced → basic: if JSON is dirty, try to parse into draft
        // 高级 → 基础：若 JSON 已脏，尝试解析回草稿
        if (jsonDirty) {
            const validated = validateConfigJson(jsonText)
            if (!validated.ok) {
                setError(validated.error)
                return
            }
            setDraft(draftFromConfigJson(validated.configJson))
            setJsonText(formatConfigJson(validated.configJson))
            setJsonDirty(false)
            setError(null)
        }
        setTab("basic")
    }

    const updateModel = (index: number, patch: Partial<ModelConfigDraft>) => {
        syncJsonFromDraft({
            ...draft,
            models: draft.models.map((model, i) => (i === index ? {...model, ...patch} : model)),
        })
    }

    const submit = () => {
        const idErr = validateProviderId(id, catalogIds, existingCustomIds, isEdit, providerUiLabels(t))
        if (idErr) return setError(idErr)

        let configJson: string
        if (tab === "advanced" || jsonDirty) {
            const validated = validateConfigJson(jsonText)
            if (!validated.ok) return setError(validated.error)
            configJson = validated.configJson
        } else {
            const fromDraft = draftToConfigJson(draft)
            const validated = validateConfigJson(fromDraft)
            if (!validated.ok) return setError(validated.error)
            configJson = validated.configJson
        }
        onClose({
            kind: "save",
            id: id.trim(),
            configJson,
            apiKey: apiKey.trim(),
        })
    }

    return <ModalShell
        title={isEdit ? t("dialogs:editProvider", {name: existing!.id}) : t("dialogs:addCustomProvider")}
        wide
        onCancel={() => onClose({kind: "cancel"})}>
        <TextField value={id} onChange={setId} disabled={isEdit}>
            <TextFieldLabel>{t("dialogs:providerId")}</TextFieldLabel>
            <TextFieldInput className="font-mono"/>
        </TextField>

        <Tabs value={tab} onValueChange={(value) => {
            if (value === "basic" || value === "advanced") switchTab(value)
        }} className="mb-3">
            <TabsList>
                <TabsTrigger value="basic">{t("dialogs:basicTab")}</TabsTrigger>
                <TabsTrigger value="advanced">{t("dialogs:advancedTab")}</TabsTrigger>
            </TabsList>
            <TabsContent value="basic" className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
                <TextField value={draft.baseUrl} onChange={(baseUrl) => syncJsonFromDraft({...draft, baseUrl})}>
                    <TextFieldLabel>{t("dialogs:baseUrl")}</TextFieldLabel>
                    <TextFieldInput placeholder="https://api.example.com/v1"/>
                </TextField>
                <div className="mb-3 flex flex-col gap-1">
                    <label className="text-xs font-medium leading-none text-muted">{t("dialogs:api")}</label>
                    <Select
                        value={API_PRESETS.includes(draft.api as (typeof API_PRESETS)[number]) ? draft.api : API_PRESETS[0]}
                        onValueChange={(api) => syncJsonFromDraft({...draft, api})}
                    >
                        <SelectTrigger className="font-mono">
                            <SelectValue placeholder="openai-completions"/>
                        </SelectTrigger>
                        <SelectContent>
                            {API_PRESETS.map((preset) => (
                                <SelectItem key={preset} value={preset} className="font-mono">
                                    {preset}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center justify-between">
                    <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-muted">{t("dialogs:models")}</h4>
                    <button type="button" className="text-xs text-accent hover:underline"
                            onClick={() => syncJsonFromDraft({
                                ...draft,
                                models: [...draft.models, emptyModelDraft(`model-${draft.models.length + 1}`)],
                            })}>{t("dialogs:addModel")}</button>
                </div>
                {draft.models.length === 0 ? (
                    <p className="m-0 text-xs text-muted">{t("dialogs:noModels")}</p>
                ) : draft.models.map((model, index) => (
                    <ModelCard
                        key={`${model.id}-${index}`}
                        model={model}
                        onChange={(patch) => updateModel(index, patch)}
                        onDuplicate={() => syncJsonFromDraft({
                            ...draft,
                            models: [
                                ...draft.models.slice(0, index + 1),
                                duplicateModel(model),
                                ...draft.models.slice(index + 1),
                            ],
                        })}
                        onRemove={() => syncJsonFromDraft({
                            ...draft,
                            models: draft.models.filter((_, i) => i !== index),
                        })}
                    />
                ))}
            </TabsContent>
            <TabsContent value="advanced">
                <p className="m-0 mb-2 text-[11px] text-muted">{t("dialogs:advancedJsonHint")}</p>
                <TextField value={jsonText} onChange={(value) => {
                    setJsonText(value)
                    setJsonDirty(true)
                    setError(null)
                }}>
                    <TextFieldLabel>{t("dialogs:advancedJson")}</TextFieldLabel>
                    <TextFieldTextArea className="h-64 font-mono text-xs"/>
                </TextField>
            </TabsContent>
        </Tabs>

        <TextField value={apiKey} onChange={setApiKey}>
            <TextFieldLabel>{t("dialogs:apiKey")}</TextFieldLabel>
            <TextFieldInput type="password" placeholder={t("dialogs:keepExistingKey")}/>
        </TextField>
        <p className="m-0 mb-2 text-[11px] text-muted">{t("dialogs:apiKeyAuthHint")}</p>
        {error && <p className="m-0 mb-2 text-xs text-destructive">{error}</p>}
        <DialogFooter>
            <Button variant="outline" onClick={() => onClose({kind: "cancel"})}>{t("common:cancel")}</Button>
            <Button onClick={submit}>{t("common:save")}</Button>
        </DialogFooter>
    </ModalShell>
}

function ModelCard({
                       model,
                       onChange,
                       onDuplicate,
                       onRemove,
                   }: {
    model: ModelConfigDraft
    onChange: (patch: Partial<ModelConfigDraft>) => void
    onDuplicate: () => void
    onRemove: () => void
}) {
    const {t} = useAppTranslation("dialogs")
    return <div className="space-y-2 rounded border border-border bg-bg/40 p-2">
        <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-muted">{model.id || t("dialogs:newModel")}</span>
            <div className="flex gap-1">
                <button type="button" className="text-[11px] text-accent hover:underline"
                        onClick={onDuplicate}>{t("dialogs:duplicateModel")}</button>
                <button type="button" className="text-[11px] text-red-400 hover:underline"
                        onClick={onRemove}>{t("common:delete")}</button>
            </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
            <TextField value={model.id}
                       onChange={(id) => onChange({id, name: model.name === model.id ? id : model.name})}>
                <TextFieldLabel>{t("dialogs:modelId")}</TextFieldLabel>
                <TextFieldInput className="font-mono text-xs"/>
            </TextField>
            <TextField value={model.name} onChange={(name) => onChange({name})}>
                <TextFieldLabel>{t("dialogs:modelName")}</TextFieldLabel>
                <TextFieldInput className="text-xs"/>
            </TextField>
            <TextField value={model.api} onChange={(api) => onChange({api})}>
                <TextFieldLabel>{t("dialogs:modelApi")}</TextFieldLabel>
                <TextFieldInput className="font-mono text-xs" placeholder={t("dialogs:inheritProvider")}/>
            </TextField>
            <TextField value={model.baseUrl} onChange={(baseUrl) => onChange({baseUrl})}>
                <TextFieldLabel>{t("dialogs:modelBaseUrl")}</TextFieldLabel>
                <TextFieldInput className="font-mono text-xs" placeholder={t("dialogs:inheritProvider")}/>
            </TextField>
            <TextField value={String(model.contextWindow)}
                       onChange={(value) => onChange({contextWindow: Number(value) || 0})}>
                <TextFieldLabel>{t("dialogs:contextWindow")}</TextFieldLabel>
                <TextFieldInput type="number" className="text-xs"/>
            </TextField>
            <TextField value={String(model.maxTokens)}
                       onChange={(value) => onChange({maxTokens: Number(value) || 0})}>
                <TextFieldLabel>{t("dialogs:maxTokens")}</TextFieldLabel>
                <TextFieldInput type="number" className="text-xs"/>
            </TextField>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-xs text-fg">
                <Switch
                    checked={model.reasoning}
                    onCheckedChange={(reasoning) => onChange({reasoning})}
                />
                {t("dialogs:reasoning")}
            </label>
            <label className="flex items-center gap-2 text-xs text-fg">
                <Switch
                    checked={model.input.includes("image")}
                    onCheckedChange={(enabled) => {
                        const withoutImage = model.input.filter((item) => item !== "image")
                        onChange({
                            input: enabled
                                ? [...(withoutImage.length > 0 ? withoutImage : ["text"]), "image"]
                                : (withoutImage.length > 0 ? withoutImage : ["text"]),
                        })
                    }}
                />
                {t("dialogs:imageInput")}
            </label>
        </div>
    </div>
}

type LoginOverlayProps = {
    state: LoginOverlayState
    onOpenBrowser: () => void
    onCancel: () => void
    onSubmitInput: (text: string) => void
    onCancelInput: () => void
}

export function LoginOverlay({state, onOpenBrowser, onCancel, onSubmitInput, onCancelInput}: LoginOverlayProps) {
    const {t} = useAppTranslation("dialogs");
    const [input, setInput] = useState("")
    return <ModalShell title={t("dialogs:loginTo", {name: state.providerName})} onCancel={onCancel}>
        <p className="m-0 mb-2 text-sm text-fg">{state.progress || t("common:working")}</p>
        {(state.url || state.launchUrl) && <div className="mb-3 flex flex-wrap gap-2"><Button
            onClick={onOpenBrowser}>{t("dialogs:openBrowser")}</Button><p
            className="m-0 self-center text-xs text-muted">{t("dialogs:completeSignIn")}</p></div>}
        {state.inputPrompt != null &&
            <div className="mb-3"><p className="m-0 mb-1 text-sm text-fg">{state.inputPrompt}</p><TextField
                className="mb-2" value={input} onChange={setInput}><TextFieldInput
                placeholder={state.inputPlaceholder ?? ""}/></TextField><DialogFooter><Button variant="outline"
                                                                                              onClick={onCancelInput}>{t("common:cancel")}</Button><Button
                onClick={() => onSubmitInput(input)}>{t("common:submit")}</Button></DialogFooter></div>}
        <DialogFooter><Button variant="outline" onClick={onCancel}>{t("dialogs:cancelLogin")}</Button></DialogFooter>
    </ModalShell>
}

function ModalShell({title, onCancel, children, wide}: {
    title: string
    onCancel: () => void
    children: ReactNode
    wide?: boolean
}) {
    return <Dialog open onOpenChange={(open) => {
        if (!open) onCancel()
    }}><DialogContent showCloseButton={false} className={wide ? "sm:max-w-2xl" : undefined}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>{children}
    </DialogContent></Dialog>
}
