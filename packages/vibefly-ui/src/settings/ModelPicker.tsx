import { AlertTriangle, Check, ChevronDown, Search, Star, X } from "lucide-solid"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { ProviderSnapshot } from "./providerSnapshots"
import { useT } from "../i18n"
import type { BundledCatalog } from "./catalog"
import {
  buildEntries,
  buildOptionEntries,
  listProviders,
  rank,
  recordUsed,
  togglePinned,
  type ModelBadge,
  type ModelPickerEntry,
  type ModelPickerOption,
  type ModelPickerRow,
} from "./modelPickerLogic"

type ModelPickerCommonProps = {
  value: string
  onChange: (spec: string, nextPinned: string[], nextRecent: string[]) => void
  pinnedSpecs: string[]
  recentSpecs: string[]
  variant?: "default" | "compact"
  allowClear?: boolean
  allowFollowDefault?: boolean
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
  followDefaultSpec?: string
  onConfigureProviders?: () => void
}

type ModelPickerCatalogSource = {
  providers: ProviderSnapshot[]
  catalog: BundledCatalog
  options?: never
}

type ModelPickerOptionSource = {
  options: ModelPickerOption[]
  providers?: never
  catalog?: never
}

export type ModelPickerProps = ModelPickerCommonProps &
  (ModelPickerCatalogSource | ModelPickerOptionSource)

export type { ModelPickerOption }

type DropdownPlacement = {
  top: number
  left: number
  width: number
  height: number
  placement: "below" | "above"
}

const DROPDOWN_GAP = 4
const DROPDOWN_EDGE = 8
const IDEAL_PANEL_HEIGHT = 420
const MIN_USEFUL_PANEL_HEIGHT = 180
let pickerSequence = 0

export function ModelPicker(props: ModelPickerProps) {
  const t = useT()
  const pickerId = `model-picker-${++pickerSequence}`
  const listId = `${pickerId}-listbox`
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [providerFilter, setProviderFilter] = createSignal("")
  const [openPinned, setOpenPinned] = createSignal<string[]>([])
  const [openRecent, setOpenRecent] = createSignal<string[]>([])
  const [livePinned, setLivePinned] = createSignal<string[]>([])
  const [liveRecent, setLiveRecent] = createSignal<string[]>([])
  const [activeIndex, setActiveIndex] = createSignal(-1)
  const [placement, setPlacement] = createSignal<DropdownPlacement | null>(null)

  let triggerEl: HTMLButtonElement | undefined
  let searchEl: HTMLInputElement | undefined
  let panelEl: HTMLDivElement | undefined
  let listEl: HTMLDivElement | undefined

  const entries = createMemo(() =>
    props.options
      ? buildOptionEntries(props.options)
      : buildEntries(props.providers, props.catalog),
  )
  const compact = () => props.variant === "compact"
  const providerOptions = createMemo(() => listProviders(entries()))
  const selectedEntry = createMemo((): ModelPickerEntry | null => {
    if (!props.value) return null
    return entries().find((entry) => entry.spec === props.value) ?? null
  })
  const selectedUnavailable = createMemo(() => Boolean(props.value && !selectedEntry()))
  const followDefaultEntry = createMemo(() => {
    const spec = props.followDefaultSpec?.trim()
    if (!spec) return null
    return entries().find((entry) => entry.spec === spec) ?? null
  })

  const rows = createMemo((): ModelPickerRow[] => {
    if (!open()) return []
    return rank(
      entries(),
      query(),
      openPinned(),
      openRecent(),
      Boolean(props.allowFollowDefault),
      providerFilter() || null,
      Boolean(props.allowClear && !props.allowFollowDefault),
    )
  })

  const modelResultCount = createMemo(
    () => rows().filter((row) => row.tier !== "follow_default" && row.tier !== "clear").length,
  )

  const optionId = (index: number) => `${pickerId}-option-${index}`
  const activeDescendant = () => {
    const index = activeIndex()
    return index >= 0 && index < rows().length ? optionId(index) : undefined
  }

  const measurePlacement = () => {
    const el = triggerEl
    if (!el) return
    const rect = el.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const maxWidth = Math.max(0, viewportWidth - DROPDOWN_EDGE * 2)
    const width = Math.min(Math.max(rect.width, 380), maxWidth)
    const left = Math.min(
      Math.max(DROPDOWN_EDGE, rect.left),
      Math.max(DROPDOWN_EDGE, viewportWidth - width - DROPDOWN_EDGE),
    )
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - DROPDOWN_GAP - DROPDOWN_EDGE)
    const spaceAbove = Math.max(0, rect.top - DROPDOWN_GAP - DROPDOWN_EDGE)
    const placeBelow =
      spaceBelow >= MIN_USEFUL_PANEL_HEIGHT || (spaceBelow >= spaceAbove && spaceBelow > 0)
    const available = placeBelow ? spaceBelow : spaceAbove
    const desiredHeight = entries().length === 0 ? 260 : IDEAL_PANEL_HEIGHT
    const height = Math.min(desiredHeight, available)
    const top = placeBelow
      ? rect.bottom + DROPDOWN_GAP
      : Math.max(DROPDOWN_EDGE, rect.top - DROPDOWN_GAP - height)
    setPlacement({
      top,
      left,
      width,
      height,
      placement: placeBelow ? "below" : "above",
    })
  }

  const openPicker = (direction: "selected" | "first" | "last" = "selected") => {
    if (props.disabled || open()) return
    setOpenPinned([...(props.pinnedSpecs ?? [])])
    setOpenRecent([...(props.recentSpecs ?? [])])
    setLivePinned([...(props.pinnedSpecs ?? [])])
    setLiveRecent([...(props.recentSpecs ?? [])])
    setQuery("")
    setProviderFilter("")
    setActiveIndex(
      direction === "last" ? Number.MAX_SAFE_INTEGER : direction === "selected" ? -2 : 0,
    )
    setOpen(true)
  }

  const closePicker = (restoreFocus = true) => {
    if (!open()) return
    setOpen(false)
    setPlacement(null)
    setActiveIndex(-1)
    if (restoreFocus) requestAnimationFrame(() => triggerEl?.focus())
  }

  const focusOption = (index: number) => {
    setActiveIndex(index)
    requestAnimationFrame(() => {
      const list = listEl
      const option = document.getElementById(optionId(index))
      if (!list || !option) return
      const listRect = list.getBoundingClientRect()
      const optionRect = option.getBoundingClientRect()
      if (optionRect.top < listRect.top) {
        list.scrollTop -= listRect.top - optionRect.top
      } else if (optionRect.bottom > listRect.bottom) {
        list.scrollTop += optionRect.bottom - listRect.bottom
      }
    })
  }

  createEffect(() => {
    if (!open()) return
    measurePlacement()
    const onReposition = () => measurePlacement()
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelEl?.contains(target) || triggerEl?.contains(target)) return
      closePicker(false)
    }
    window.addEventListener("resize", onReposition)
    window.addEventListener("scroll", onReposition, true)
    document.addEventListener("focusin", onFocusIn)
    requestAnimationFrame(() => searchEl?.focus())
    onCleanup(() => {
      window.removeEventListener("resize", onReposition)
      window.removeEventListener("scroll", onReposition, true)
      document.removeEventListener("focusin", onFocusIn)
    })
  })

  createEffect(() => {
    if (!open()) return
    const currentRows = rows()
    if (currentRows.length === 0) {
      setActiveIndex(-1)
      return
    }
    const requested = activeIndex()
    const selectedIndex = currentRows.findIndex((row) => row.entry.spec === props.value)
    const next =
      requested === Number.MAX_SAFE_INTEGER
        ? currentRows.length - 1
        : requested < 0 || requested >= currentRows.length
          ? Math.max(0, selectedIndex)
          : requested
    if (next !== requested) focusOption(next)
  })

  createEffect(() => {
    if (props.disabled && open()) closePicker(false)
  })

  const triggerPrimary = () => {
    if (!props.value) {
      if (props.allowFollowDefault) return t("modelPicker.followDefault")
      if (props.allowClear) return props.placeholder ?? t("modelPicker.noDefault")
      return props.placeholder ?? t("modelPicker.selectModel")
    }
    return selectedEntry()?.modelLabel ?? props.value
  }

  const triggerSecondary = () => {
    const entry = selectedEntry()
    if (entry) return `${entry.providerLabel} · ${entry.modelId}`
    if (selectedUnavailable()) return t("modelPicker.unavailable")
    if (!props.value && props.allowFollowDefault) {
      const resolved = followDefaultEntry()
      if (resolved) {
        return t("modelPicker.currentDefault", {
          model: `${resolved.providerLabel} · ${resolved.modelLabel}`,
        })
      }
      if (props.followDefaultSpec) {
        return t("modelPicker.currentDefault", { model: props.followDefaultSpec })
      }
    }
    return null
  }

  const groupLabel = (row: ModelPickerRow) => {
    if (row.tier === "follow_default" || row.tier === "clear") {
      return t("modelPicker.groupDefault")
    }
    if (row.tier === "pinned") return t("modelPicker.groupPinned")
    if (row.tier === "recent") return t("modelPicker.groupRecent")
    return row.groupLabel
  }

  const rowLabel = (row: ModelPickerRow) => {
    if (row.tier === "follow_default") return t("modelPicker.followDefault")
    if (row.tier === "clear") return t("modelPicker.noDefault")
    return `${row.entry.modelLabel}, ${row.entry.providerLabel}, ${row.entry.modelId}`
  }

  const select = (spec: string) => {
    let recent = liveRecent()
    if (spec) recent = recordUsed(recent, spec)
    props.onChange(spec, livePinned(), recent)
    closePicker()
  }

  const togglePin = (spec: string) => {
    const next = togglePinned(livePinned(), spec)
    setLivePinned(next)
    props.onChange(props.value, next, liveRecent())
  }

  const onTogglePin = (spec: string, event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    togglePin(spec)
  }

  const moveActive = (delta: number) => {
    const length = rows().length
    if (length === 0) return
    const current = activeIndex()
    const next =
      current < 0
        ? delta > 0
          ? 0
          : length - 1
        : Math.min(length - 1, Math.max(0, current + delta))
    focusOption(next)
  }

  const onSearchKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      moveActive(1)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      moveActive(-1)
    } else if (event.key === "Home") {
      event.preventDefault()
      if (rows().length > 0) focusOption(0)
    } else if (event.key === "End") {
      event.preventDefault()
      if (rows().length > 0) focusOption(rows().length - 1)
    } else if (event.key === "PageDown") {
      event.preventDefault()
      moveActive(5)
    } else if (event.key === "PageUp") {
      event.preventDefault()
      moveActive(-5)
    } else if (event.key === "Enter") {
      const row = rows()[activeIndex()]
      if (row) {
        event.preventDefault()
        select(row.entry.spec)
      }
    } else if (event.key === "Escape") {
      event.preventDefault()
      closePicker()
    } else if (event.altKey && event.key.toLowerCase() === "p") {
      const row = rows()[activeIndex()]
      if (row && row.tier !== "follow_default" && row.tier !== "clear") {
        event.preventDefault()
        togglePin(row.entry.spec)
      }
    }
  }

  const updateQuery = (value: string) => {
    setQuery(value)
    focusOption(0)
  }

  const updateProvider = (value: string) => {
    setProviderFilter(value)
    focusOption(0)
  }

  const clearFilters = () => {
    setQuery("")
    setProviderFilter("")
    focusOption(0)
    requestAnimationFrame(() => searchEl?.focus())
  }

  const badgeLabel = (badge: ModelBadge) => {
    if (badge.kind === "reasoning") return t("modelPicker.badgeReasoning")
    if (badge.kind === "vision") return t("modelPicker.badgeVision")
    if (badge.kind === "tools_unsupported") return t("modelPicker.badgeNoTools")
    return badge.label
  }

  const badgeTitle = (badge: ModelBadge) => {
    if (badge.kind === "context") {
      return t("modelPicker.badgeContextTitle", { value: badge.label })
    }
    if (badge.kind === "cost") {
      return t("modelPicker.badgeCostTitle", { value: badge.label })
    }
    if (badge.kind === "reasoning") return t("modelPicker.badgeReasoningTitle")
    if (badge.kind === "vision") return t("modelPicker.badgeVisionTitle")
    return t("modelPicker.badgeNoToolsTitle")
  }

  return (
    <div
      class="model-picker relative"
      classList={{ "w-full": !compact(), "model-picker-compact": compact() }}
    >
      <button
        ref={triggerEl}
        type="button"
        class="flex w-full items-center justify-between gap-2 rounded border border-border text-left text-fg outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        classList={{
          "min-h-10 bg-surface px-3 py-1.5": !compact(),
          "h-[29px] min-h-[29px] bg-surface-raised px-2 py-0": compact(),
        }}
        disabled={props.disabled}
        aria-label={props.ariaLabel ?? t("modelPicker.selectModel")}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={open() && entries().length > 0 ? listId : undefined}
        onClick={() => (open() ? closePicker(false) : openPicker())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            openPicker(event.key === "ArrowUp" ? "last" : "first")
          } else if (event.key === "Escape" && open()) {
            event.preventDefault()
            closePicker(false)
          }
        }}
      >
        <span
          class="min-w-0 flex-1"
          classList={{ "flex items-center gap-1": compact() }}
        >
          <Show when={compact() && selectedUnavailable()}>
            <AlertTriangle class="size-3 shrink-0 text-warning" aria-hidden="true" />
          </Show>
          <span
            class="block truncate"
            classList={{ "text-sm": !compact(), "text-[11px]": compact() }}
          >
            {triggerPrimary()}
          </span>
          <Show when={!compact() && triggerSecondary()}>
            {(secondary) => (
              <span
                class="mt-0.5 flex items-center gap-1 truncate font-mono text-[11px] text-muted"
                classList={{ "text-warning": selectedUnavailable() }}
              >
                <Show when={selectedUnavailable()}>
                  <AlertTriangle class="size-3 shrink-0" aria-hidden="true" />
                </Show>
                <span class="truncate">{secondary()}</span>
              </span>
            )}
          </Show>
        </span>
        <ChevronDown
          class="size-4 shrink-0 text-muted transition-transform"
          classList={{ "rotate-180": open() }}
          aria-hidden="true"
        />
      </button>

      <Show when={open() && placement()}>
        {(currentPlacement) => (
          <>
            <div
              ref={panelEl}
              class="fixed z-50 flex flex-col overflow-hidden rounded border border-border bg-bg shadow-lg"
              classList={{ "origin-bottom": currentPlacement().placement === "above" }}
              style={{
                top: `${currentPlacement().top}px`,
                left: `${currentPlacement().left}px`,
                width: `${currentPlacement().width}px`,
                height: `${currentPlacement().height}px`,
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  closePicker()
                }
              }}
            >
              <Show when={entries().length > 0}>
                <div class="grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(6rem,8rem)] gap-2 border-b border-border p-2">
                  <label class="relative block min-w-0">
                    <Search class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" aria-hidden="true" />
                    <input
                      ref={searchEl}
                      role="combobox"
                      class="h-8 w-full rounded border border-border bg-surface pl-7 pr-7 text-sm text-fg outline-none placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-ring"
                      placeholder={t("modelPicker.searchModels")}
                      value={query()}
                      aria-label={t("modelPicker.searchModels")}
                      aria-autocomplete="list"
                      aria-expanded="true"
                      aria-controls={listId}
                      aria-activedescendant={activeDescendant()}
                      onInput={(event) => updateQuery(event.currentTarget.value)}
                      onKeyDown={onSearchKeyDown}
                    />
                    <Show when={query()}>
                      <button
                        type="button"
                        class="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted hover:bg-surface-raised hover:text-fg"
                        title={t("modelPicker.clearSearch")}
                        aria-label={t("modelPicker.clearSearch")}
                        onClick={() => updateQuery("")}
                      >
                        <X class="size-3.5" />
                      </button>
                    </Show>
                  </label>
                  <select
                    class="h-8 min-w-0 rounded border border-border bg-surface px-2 text-xs text-fg outline-none focus:border-accent focus:ring-1 focus:ring-ring"
                    value={providerFilter()}
                    onChange={(event) => updateProvider(event.currentTarget.value)}
                    aria-label={t("modelPicker.limitProvider")}
                    title={t("modelPicker.limitProvider")}
                  >
                    <option value="">{t("modelPicker.allProviders")}</option>
                    <For each={providerOptions()}>
                      {(provider) => <option value={provider.id}>{provider.label}</option>}
                    </For>
                  </select>
                </div>
              </Show>

              <Show when={selectedUnavailable()}>
                <div class="flex shrink-0 items-start gap-2 border-b border-border bg-surface px-3 py-2 text-xs text-warning">
                  <AlertTriangle class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>{t("modelPicker.unavailableHint", { spec: props.value })}</span>
                </div>
              </Show>

              <Show
                when={entries().length > 0}
                fallback={
                  <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-5 text-center">
                    <div class="text-sm font-medium text-fg">{t("modelPicker.noProviders")}</div>
                    <div class="text-xs text-muted">{t("modelPicker.noProvidersHint")}</div>
                    <Show when={(props.allowFollowDefault || props.allowClear) && props.value}>
                      <button
                        type="button"
                        class="mt-1 rounded border border-border bg-surface px-2.5 py-1.5 text-xs text-fg hover:border-accent"
                        onClick={() => select("")}
                      >
                        {props.allowFollowDefault
                          ? t("modelPicker.followDefault")
                          : t("modelPicker.noDefault")}
                      </button>
                    </Show>
                    <Show when={props.onConfigureProviders}>
                      {(configure) => (
                        <button
                          type="button"
                          class="mt-1 rounded border border-border bg-surface px-2.5 py-1.5 text-xs text-fg hover:border-accent"
                          onClick={() => {
                            closePicker(false)
                            configure()()
                          }}
                        >
                          {t("modelPicker.configureProviders")}
                        </button>
                      )}
                    </Show>
                  </div>
                }
              >
                <div
                  ref={listEl}
                  id={listId}
                  role="listbox"
                  aria-label={props.ariaLabel ?? t("modelPicker.selectModel")}
                  class="min-h-0 flex-1 overflow-y-auto"
                >
                  <Show
                    when={rows().length > 0}
                    fallback={
                      <div class="flex h-full min-h-32 flex-col items-center justify-center gap-2 px-3 py-5 text-center">
                        <div class="text-sm text-muted">
                          {query()
                            ? t("modelPicker.noMatchFor", { query: query().trim() })
                            : t("modelPicker.noMatch")}
                        </div>
                        <Show when={query() || providerFilter()}>
                          <button
                            type="button"
                            class="text-xs text-accent hover:underline"
                            onClick={clearFilters}
                          >
                            {t("modelPicker.clearFilters")}
                          </button>
                        </Show>
                      </div>
                    }
                  >
                    <For each={rows()}>
                      {(row, index) => {
                        const isPinned = () => livePinned().includes(row.entry.spec)
                        const isSelected = () => row.entry.spec === props.value
                        return (
                          <>
                            <Show when={row.isFirstInGroup && groupLabel(row)}>
                              <div class="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase text-muted">
                                {groupLabel(row)}
                              </div>
                            </Show>
                            <div
                              id={optionId(index())}
                              role="option"
                              aria-label={rowLabel(row)}
                              aria-selected={isSelected()}
                              class="group flex min-h-14 cursor-default items-center gap-1.5 px-2 py-1.5 outline-none"
                              classList={{
                                "bg-surface-raised": activeIndex() === index(),
                                "bg-surface/70": activeIndex() !== index() && isSelected(),
                              }}
                              onMouseEnter={() => setActiveIndex(index())}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => select(row.entry.spec)}
                            >
                              <span class="grid size-5 shrink-0 place-items-center text-accent">
                                <Show when={isSelected()}>
                                  <Check class="size-3.5" aria-hidden="true" />
                                </Show>
                              </span>
                              <Show when={row.tier !== "follow_default" && row.tier !== "clear"}>
                                <button
                                  type="button"
                                  class="grid size-7 shrink-0 place-items-center rounded text-muted hover:bg-surface hover:text-accent focus-visible:ring-2 focus-visible:ring-ring"
                                  classList={{ "text-accent": isPinned() }}
                                  title={isPinned() ? t("modelPicker.unpin") : t("modelPicker.pin")}
                                  aria-label={isPinned() ? t("modelPicker.unpin") : t("modelPicker.pin")}
                                  aria-pressed={isPinned()}
                                  onClick={(event) => onTogglePin(row.entry.spec, event)}
                                >
                                  <Star class="size-3.5" fill={isPinned() ? "currentColor" : "none"} />
                                </button>
                              </Show>
                              <div class="min-w-0 flex-1">
                                <div class="truncate text-sm text-fg">
                                  {row.tier === "follow_default"
                                    ? t("modelPicker.followDefault")
                                    : row.tier === "clear"
                                      ? t("modelPicker.noDefault")
                                      : row.entry.modelLabel}
                                </div>
                                <Show when={row.tier !== "follow_default" && row.tier !== "clear"}>
                                  <div class="truncate font-mono text-[11px] text-muted">
                                    {row.entry.providerLabel} · {row.entry.modelId}
                                  </div>
                                </Show>
                                <Show when={row.tier === "follow_default" && props.followDefaultSpec}>
                                  <div class="truncate text-[11px] text-muted">
                                    {t("modelPicker.currentDefault", {
                                      model: followDefaultEntry()?.modelLabel ?? props.followDefaultSpec!,
                                    })}
                                  </div>
                                </Show>
                              </div>
                              <Show when={row.entry.badges.length > 0}>
                                <div class="flex max-w-[45%] shrink-0 flex-wrap justify-end gap-1">
                                  <For each={row.entry.badges}>
                                    {(badge) => (
                                      <span
                                        class="rounded bg-surface px-1 py-0.5 text-[10px] text-muted"
                                        classList={{ "text-warning": badge.warning }}
                                        title={badgeTitle(badge)}
                                      >
                                        {badgeLabel(badge)}
                                      </span>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          </>
                        )
                      }}
                    </For>
                  </Show>
                </div>
                <div class="shrink-0 border-t border-border px-3 py-1 text-right text-[10px] text-muted">
                  <span aria-live="polite">
                    {t(modelResultCount() === 1 ? "modelPicker.result" : "modelPicker.results", {
                      count: String(modelResultCount()),
                    })}
                  </span>
                </div>
              </Show>
            </div>
            <div class="fixed inset-0 z-40" aria-hidden="true" onMouseDown={() => closePicker()} />
          </>
        )}
      </Show>
    </div>
  )
}
