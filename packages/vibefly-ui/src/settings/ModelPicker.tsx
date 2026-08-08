import {AlertTriangle, Check, ChevronDown, Search, Star, X} from "lucide-react"
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react"

import type {ProviderSnapshot} from "./providerSnapshots"
import {type Translator, useAppTranslation} from "../i18n"
import {type BundledCatalog, type CatalogModel, loadCatalogModelsForProviders,} from "./catalog"
import {
    buildEntries,
    buildOptionEntries,
    connectedCatalogProviderIds,
    listProviders,
    type ModelBadge,
    type ModelPickerOption,
    type ModelPickerRow,
    rank,
    recordUsed,
    togglePinned
} from "./modelPickerLogic"

type ModelPickerCommonProps = {
    value: string;
    onChange: (spec: string, nextPinned: string[], nextRecent: string[]) => void;
    pinnedSpecs: string[];
    recentSpecs: string[];
    variant?: "default" | "compact";
    allowClear?: boolean;
    allowFollowDefault?: boolean;
    disabled?: boolean;
    placeholder?: string;
    ariaLabel?: string;
    followDefaultSpec?: string;
    onConfigureProviders?: () => void
}
type ModelPickerCatalogSource = { providers: ProviderSnapshot[]; catalog: BundledCatalog; options?: never }
type ModelPickerOptionSource = { options: ModelPickerOption[]; providers?: never; catalog?: never }
export type ModelPickerProps = ModelPickerCommonProps & (ModelPickerCatalogSource | ModelPickerOptionSource)
export type {ModelPickerOption}

let pickerSequence = 0

function catalogSourceKey(providers: ProviderSnapshot[]): string {
    return connectedCatalogProviderIds(providers).join("\0")
}

export function ModelPicker(props: ModelPickerProps) {
    const {t} = useAppTranslation("modelPicker")
    const pickerId = `model-picker-${++pickerSequence}`
    const listId = `${pickerId}-listbox`
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")
    const [providerFilter, setProviderFilter] = useState("")
    const [openPinned, setOpenPinned] = useState<string[]>(props.pinnedSpecs)
    const [openRecent, setOpenRecent] = useState<string[]>(props.recentSpecs)
    const [activeIndex, setActiveIndex] = useState(-1)
    const [modelsByProvider, setModelsByProvider] = useState<Map<string, CatalogModel[]>>(() => new Map())
    const [modelsLoading, setModelsLoading] = useState(false)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const labelRef = useRef<HTMLSpanElement>(null)
    const measureRef = useRef<HTMLSpanElement>(null)
    const searchRef = useRef<HTMLInputElement>(null)
    const compact = props.variant === "compact"
    const usesCatalog = !("options" in props && props.options)
    const catalogProvidersKey = usesCatalog && "providers" in props
        ? catalogSourceKey(props.providers)
        : ""

    useEffect(() => {
        if (!usesCatalog || !("providers" in props)) {
            setModelsByProvider(new Map())
            setModelsLoading(false)
            return
        }
        const ids = connectedCatalogProviderIds(props.providers)
        if (ids.length === 0) {
            setModelsByProvider(new Map())
            setModelsLoading(false)
            return
        }
        let cancelled = false
        setModelsLoading(true)
        void loadCatalogModelsForProviders(ids)
            .then((map) => {
                if (!cancelled) {
                    setModelsByProvider(map)
                    setModelsLoading(false)
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setModelsByProvider(new Map())
                    setModelsLoading(false)
                }
            })
        return () => {
            cancelled = true
        }
    }, [usesCatalog, catalogProvidersKey])

    const entries = useMemo(() => {
        if ("options" in props && props.options) return buildOptionEntries(props.options)
        return buildEntries(props.providers, props.catalog, modelsByProvider)
    }, [props, modelsByProvider])
    const providerOptions = useMemo(() => listProviders(entries), [entries])
    const rows = useMemo(() => open ? rank(entries, query, openPinned, openRecent, Boolean(props.allowFollowDefault), providerFilter || null, Boolean(props.allowClear)) : [], [entries, open, openPinned, openRecent, props.allowClear, props.allowFollowDefault, providerFilter, query])
    const selectedEntry = entries.find((entry) => entry.spec === props.value)
    const selectedUnavailable = Boolean(props.value && !selectedEntry && !modelsLoading)
    const followDefaultEntry = entries.find((entry) => entry.spec === props.followDefaultSpec?.trim())
    const resultCount = rows.filter((row) => row.tier !== "follow_default" && row.tier !== "clear").length
    const [showProvider, setShowProvider] = useState(true)

    useEffect(() => {
        if (!open) return
        setOpenPinned(props.pinnedSpecs)
        setOpenRecent(props.recentSpecs)
        requestAnimationFrame(() => searchRef.current?.focus())
        const onPointerDown = (event: PointerEvent) => {
            if (!(event.target instanceof Node) || !triggerRef.current?.parentElement?.contains(event.target)) setOpen(false)
        }
        document.addEventListener("pointerdown", onPointerDown)
        return () => document.removeEventListener("pointerdown", onPointerDown)
    }, [open, props.pinnedSpecs, props.recentSpecs])

    useEffect(() => {
        if (!props.disabled) return
        setOpen(false)
    }, [props.disabled])

    const select = (spec: string) => {
        const recent = spec ? recordUsed(openRecent, spec) : openRecent
        props.onChange(spec, openPinned, recent)
        setOpen(false)
        setQuery("")
        setProviderFilter("")
    }
    const togglePin = (spec: string, event: React.MouseEvent) => {
        event.stopPropagation();
        event.preventDefault()
        setOpenPinned((current) => togglePinned(current, spec))
    }
    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            return
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => Math.min(rows.length - 1, current + 1));
            return
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => Math.max(0, current - 1));
            return
        }
        if (event.key === "Enter" && activeIndex >= 0 && rows[activeIndex]) {
            event.preventDefault();
            select(rows[activeIndex].entry.spec);
        }
    }
    const primary = selectedEntry?.modelLabel ?? (props.value || props.placeholder || t("modelPicker:selectModel"))
    const providerSecondary = selectedUnavailable
        ? null
        : selectedEntry?.providerLabel ?? (followDefaultEntry?.modelLabel ?? props.followDefaultSpec ?? "")
    const statusSecondary = selectedUnavailable ? t("modelPicker:unavailable") : null
    const secondary = statusSecondary ?? (showProvider ? providerSecondary : null)
    const fullTitle = selectedUnavailable
        ? `${primary} · ${t("modelPicker:unavailable")}`
        : providerSecondary
            ? `${primary} · ${providerSecondary}`
            : primary

    useLayoutEffect(() => {
        if (selectedUnavailable || !providerSecondary) {
            setShowProvider(false)
            return
        }
        const label = labelRef.current
        const measure = measureRef.current
        if (!label || !measure) return
        const update = () => {
            setShowProvider(measure.scrollWidth <= label.clientWidth)
        }
        update()
        const observer = new ResizeObserver(update)
        observer.observe(label)
        return () => observer.disconnect()
    }, [primary, providerSecondary, selectedUnavailable, compact, props.value])

    return <div className={`relative ${compact ? "model-picker-compact" : "w-full"}`}>
        <button ref={triggerRef} type="button"
                className={`flex items-center justify-between gap-1 rounded border border-border text-left text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring ${compact ? "h-[29px] min-h-[29px] max-w-full bg-surface-raised px-2 py-0 text-[11px]" : "w-full min-h-10 bg-surface px-3 py-1.5 text-sm"}`}
                aria-label={props.ariaLabel} aria-expanded={open} aria-controls={open ? listId : undefined}
                title={fullTitle}
                disabled={props.disabled} onClick={() => setOpen((current) => !current)} onKeyDown={onKeyDown}>
            <span ref={labelRef} className="relative min-w-0 flex-1 truncate">
                <span ref={measureRef} className="pointer-events-none absolute left-0 top-0 whitespace-nowrap opacity-0"
                      aria-hidden>
                    <span className={compact ? "text-[11px]" : "text-sm"}>{primary}</span>
                    {providerSecondary ? <span className="ml-2 text-xs">{providerSecondary}</span> : null}
                </span>
                <span className={compact ? "text-[11px]" : "text-sm"}>{primary}</span>
                {secondary ? (
                    <span className={`ml-2 text-xs ${selectedUnavailable ? "text-warning" : "text-muted"}`}>
                        {selectedUnavailable ? <AlertTriangle className="mr-1 inline size-3"/> : null}
                        {secondary}
                    </span>
                ) : null}
            </span>
            <ChevronDown size={compact ? 12 : 16} strokeWidth={2}
                         className={`composer-select-chevron shrink-0 text-muted transition-transform ${compact ? (open ? "" : "rotate-180") : (open ? "rotate-180" : "")}`}/>
        </button>
        {open && <div
            className={`absolute z-50 flex max-h-[min(420px,calc(100vh-16px))] flex-col overflow-hidden rounded border border-border bg-bg shadow-lg ${
                compact
                    ? "bottom-[calc(100%+4px)] left-0 w-[min(380px,calc(100vw-24px))]"
                    : "left-0 right-0 top-[calc(100%+4px)] min-w-[min(100%,380px)]"
            }`}
            onKeyDown={onKeyDown}>
            {entries.length > 0 && <div
                className="grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(6.5rem,8.5rem)] gap-2 border-b border-border p-2">
                <label className="relative block min-w-0"><Search
                    className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted"/><input
                    ref={searchRef} role="combobox"
                    className="h-8 w-full min-w-0 rounded border border-border bg-surface pl-7 pr-7 text-sm text-fg outline-none placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-ring"
                    placeholder={t("modelPicker:searchModels")} value={query} aria-label={t("modelPicker:searchModels")}
                    aria-expanded aria-controls={listId}
                    onChange={(event) => setQuery(event.currentTarget.value)}/>{query && <button type="button"
                                                                                                 className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-fg"
                                                                                                 onClick={() => setQuery("")}>
                    <X className="size-3"/></button>}</label><select
                className="h-8 min-w-0 rounded border border-border bg-surface px-2 text-xs text-fg"
                value={providerFilter}
                aria-label={t("modelPicker:limitProvider")}
                onChange={(event) => setProviderFilter(event.currentTarget.value)}>
                <option value="">{t("modelPicker:allProviders")}</option>
                {providerOptions.map((provider) => <option key={provider.id}
                                                           value={provider.id}>{provider.label}</option>)}</select>
            </div>}
            {selectedUnavailable && <div
                className="flex items-start gap-2 border-b border-border bg-warning/10 px-3 py-2 text-xs text-warning">
                <AlertTriangle
                    className="mt-0.5 size-3.5 shrink-0"/><span>{t("modelPicker:unavailableHint", {spec: props.value})}</span>
            </div>}
            <div id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1">
                {(props.allowFollowDefault || props.allowClear) && props.value && <button type="button"
                                                                                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-raised"
                                                                                          onClick={() => select("")}>{props.allowClear ? t("modelPicker:noDefault") : t("modelPicker:followDefault")}</button>}
                {props.onConfigureProviders && entries.length === 0 && <button type="button"
                                                                               className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-accent hover:bg-surface-raised"
                                                                               onClick={props.onConfigureProviders}>{t("modelPicker:configureProviders")}</button>}
                {rows.length === 0 ? <div
                    className="p-3 text-center text-xs text-muted">{modelsLoading ? t("modelPicker:loadingModels") : query || providerFilter ? (query ? t("modelPicker:noMatchFor", {query: query.trim()}) : t("modelPicker:noMatch")) : t("modelPicker:noProviders")}</div> : rows.map((row, index) =>
                    <ModelRow key={`${row.tier}:${row.entry.spec}:${index}`} row={row} index={index}
                              active={index === activeIndex} selected={row.entry.spec === props.value}
                              pinned={openPinned.includes(row.entry.spec)} onSelect={() => select(row.entry.spec)}
                              onTogglePin={(event) => togglePin(row.entry.spec, event)} t={t}/>)}
            </div>
            <div
                className="border-t border-border px-2 py-1 text-right text-[10px] text-muted">{t("modelPicker:result", {count: resultCount})}</div>
        </div>}
    </div>
}

function ModelRow({row, index, active, selected, pinned, onSelect, onTogglePin, t}: {
    row: ModelPickerRow;
    index: number;
    active: boolean;
    selected: boolean;
    pinned: boolean;
    onSelect: () => void;
    onTogglePin: (event: React.MouseEvent) => void;
    t: Translator
}) {
    const entry = row.entry
    return <>{row.isFirstInGroup && row.groupLabel && <div
        className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">{row.groupLabel}</div>}
        <div id={`model-picker-option-${index}`} role="option" aria-selected={selected}
             className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm outline-none ${active ? "bg-surface-raised" : selected ? "bg-surface/70" : ""}`}
             onMouseEnter={() => undefined} onMouseDown={(event) => event.preventDefault()} onClick={onSelect}><span
            className="flex size-4 shrink-0 items-center justify-center">{selected &&
            <Check className="size-3.5"/>}</span><span className="min-w-0 flex-1"><span
            className="block truncate text-fg">{entry.modelLabel}</span><span
            className="block truncate text-[11px] text-muted">{entry.providerLabel} / {entry.modelId}</span><span
            className="flex flex-wrap gap-1 pt-0.5">{entry.badges.map((badge: ModelBadge) => <span key={badge.kind}
                                                                                                   className={`text-[10px] ${badge.warning ? "text-warning" : "text-muted"}`}>{badge.label}</span>)}</span></span>{row.tier !== "follow_default" && row.tier !== "clear" &&
            <button type="button" className={`shrink-0 p-1 ${pinned ? "text-accent" : "text-muted"}`}
                    title={pinned ? t("modelPicker:unpin") : t("modelPicker:pin")}
                    aria-label={pinned ? t("modelPicker:unpin") : t("modelPicker:pin")} aria-pressed={pinned}
                    onClick={onTogglePin}><Star className="size-3.5" fill={pinned ? "currentColor" : "none"}/></button>}
        </div>
    </>
}
