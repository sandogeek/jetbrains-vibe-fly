import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { ProviderSnapshot } from "../generated/rpc"
import { useT } from "../i18n"
import type { BundledCatalog } from "./catalog"
import {
  buildEntries,
  displayLabel,
  listProviders,
  MAX_RENDERED_ROWS,
  rank,
  recordUsed,
  togglePinned,
  type ModelPickerEntry,
  type ModelPickerRow,
} from "./modelPickerLogic"

export type ModelPickerProps = {
  value: string
  onChange: (spec: string, nextPinned: string[], nextRecent: string[]) => void
  providers: ProviderSnapshot[]
  catalog: BundledCatalog
  pinnedSpecs: string[]
  recentSpecs: string[]
  allowClear?: boolean
  allowFollowDefault?: boolean
  disabled?: boolean
  placeholder?: string
}

type DropdownPlacement = {
  top: number
  left: number
  width: number
  maxHeight: number
  placement: "below" | "above"
}

const DROPDOWN_GAP = 4
const DROPDOWN_EDGE = 8
/** Search + provider filter chrome inside the panel. */
const DROPDOWN_CHROME = 96
const MIN_LIST_HEIGHT = 120
const IDEAL_LIST_HEIGHT = 288

export function ModelPicker(props: ModelPickerProps) {
  const t = useT()
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [providerFilter, setProviderFilter] = createSignal("")
  // Snapshot pin order at open so star toggles don't reshuffle until reopen.
  const [openPinned, setOpenPinned] = createSignal<string[]>([])
  const [openRecent, setOpenRecent] = createSignal<string[]>([])
  const [livePinned, setLivePinned] = createSignal<string[]>([])
  const [liveRecent, setLiveRecent] = createSignal<string[]>([])
  const [placement, setPlacement] = createSignal<DropdownPlacement | null>(null)

  let triggerEl: HTMLButtonElement | undefined

  const entries = createMemo(() => buildEntries(props.providers, props.catalog))

  const providerOptions = createMemo(() => listProviders(entries()))

  const selectedEntry = createMemo((): ModelPickerEntry | null => {
    const spec = props.value
    if (!spec) return null
    return entries().find((e) => e.spec === spec) ?? null
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
    )
  })

  const visibleRows = createMemo(() => rows().slice(0, MAX_RENDERED_ROWS))
  const truncated = createMemo(() => rows().length > MAX_RENDERED_ROWS)

  const measurePlacement = () => {
    const el = triggerEl
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.max(rect.width, 320)
    const left = Math.min(Math.max(DROPDOWN_EDGE, rect.left), Math.max(DROPDOWN_EDGE, vw - width - DROPDOWN_EDGE))
    const spaceBelow = vh - rect.bottom - DROPDOWN_GAP - DROPDOWN_EDGE
    const spaceAbove = rect.top - DROPDOWN_GAP - DROPDOWN_EDGE
    const placeBelow = spaceBelow >= MIN_LIST_HEIGHT + DROPDOWN_CHROME || spaceBelow >= spaceAbove
    const available = placeBelow ? spaceBelow : spaceAbove
    const maxHeight = Math.max(
      MIN_LIST_HEIGHT + DROPDOWN_CHROME,
      Math.min(IDEAL_LIST_HEIGHT + DROPDOWN_CHROME, available),
    )
    setPlacement({
      top: placeBelow ? rect.bottom + DROPDOWN_GAP : rect.top - DROPDOWN_GAP - maxHeight,
      left,
      width,
      maxHeight,
      placement: placeBelow ? "below" : "above",
    })
  }

  createEffect(() => {
    if (open()) {
      setOpenPinned([...(props.pinnedSpecs ?? [])])
      setOpenRecent([...(props.recentSpecs ?? [])])
      setLivePinned([...(props.pinnedSpecs ?? [])])
      setLiveRecent([...(props.recentSpecs ?? [])])
      setQuery("")
      setProviderFilter("")
      measurePlacement()
      const onReposition = () => measurePlacement()
      window.addEventListener("resize", onReposition)
      window.addEventListener("scroll", onReposition, true)
      onCleanup(() => {
        window.removeEventListener("resize", onReposition)
        window.removeEventListener("scroll", onReposition, true)
      })
    } else {
      setPlacement(null)
    }
  })

  const buttonLabel = () => {
    if (!props.value) {
      if (props.allowFollowDefault) return t("modelPicker.followDefault")
      if (props.allowClear) return props.placeholder ?? t("modelPicker.noDefault")
      return props.placeholder ?? t("modelPicker.selectModel")
    }
    const entry = selectedEntry()
    if (entry) {
      if (!entry.spec) {
        return props.allowFollowDefault ? t("modelPicker.followDefault") : t("modelPicker.noDefault")
      }
      return displayLabel(entry, Boolean(props.allowFollowDefault))
    }
    return props.value
  }

  const groupLabel = (row: ModelPickerRow) => {
    if (row.tier === "follow_default") return t("modelPicker.groupDefault")
    if (row.tier === "pinned") return t("modelPicker.groupPinned")
    if (row.tier === "recent") return t("modelPicker.groupRecent")
    return row.groupLabel
  }

  const select = (spec: string) => {
    let pinned = livePinned()
    let recent = liveRecent()
    if (spec) {
      recent = recordUsed(recent, spec)
    }
    props.onChange(spec, pinned, recent)
    setOpen(false)
  }

  const onTogglePin = (spec: string, e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const next = togglePinned(livePinned(), spec)
    setLivePinned(next)
    // Keep openPinned stable so list order doesn't reshuffle.
    props.onChange(props.value, next, liveRecent())
  }

  const listMaxHeight = () => {
    const p = placement()
    if (!p) return IDEAL_LIST_HEIGHT
    return Math.max(MIN_LIST_HEIGHT, p.maxHeight - DROPDOWN_CHROME)
  }

  return (
    <div class="relative w-full">
      <button
        ref={triggerEl}
        type="button"
        class="flex w-full items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2 text-left text-sm text-fg hover:border-accent disabled:opacity-50"
        disabled={props.disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span class="truncate font-mono text-xs sm:text-sm">{buttonLabel()}</span>
        <span class="text-muted">▾</span>
      </button>

      <Show when={open() && placement()}>
        {(p) => (
          <>
            <div
              class="fixed z-50 flex flex-col overflow-hidden rounded border border-border bg-bg shadow-lg"
              style={{
                top: `${p().top}px`,
                left: `${p().left}px`,
                width: `${p().width}px`,
                "max-height": `${p().maxHeight}px`,
              }}
            >
              <div class="flex shrink-0 flex-col gap-2 border-b border-border p-2">
                <input
                  class="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:border-accent"
                  placeholder={t("modelPicker.searchModels")}
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                />
                <select
                  class="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                  value={providerFilter()}
                  onChange={(e) => setProviderFilter(e.currentTarget.value)}
                  title={t("modelPicker.limitProvider")}
                >
                  <option value="">{t("modelPicker.allProviders")}</option>
                  <For each={providerOptions()}>
                    {(prov) => <option value={prov.id}>{prov.label}</option>}
                  </For>
                </select>
              </div>

              <div class="min-h-0 flex-1 overflow-y-auto py-1" style={{ "max-height": `${listMaxHeight()}px` }}>
                <Show when={props.allowClear && !props.allowFollowDefault}>
                  <button
                    type="button"
                    class="flex w-full items-center px-3 py-1.5 text-left text-sm text-muted hover:bg-surface"
                    onClick={() => select("")}
                  >
                    {t("modelPicker.noDefault")}
                  </button>
                </Show>

                <For each={visibleRows()}>
                  {(row) => (
                    <>
                      <Show when={row.isFirstInGroup && groupLabel(row)}>
                        <div class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          {groupLabel(row)}
                        </div>
                      </Show>
                      <div
                        class="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-surface"
                        classList={{
                          "bg-surface/80": row.entry.spec === props.value,
                        }}
                        onClick={() => select(row.entry.spec)}
                      >
                        <Show when={row.tier !== "follow_default"}>
                          <button
                            type="button"
                            class="shrink-0 px-1 text-sm text-muted hover:text-accent"
                            title={
                              livePinned().includes(row.entry.spec)
                                ? t("modelPicker.unpin")
                                : t("modelPicker.pin")
                            }
                            onClick={(e) => onTogglePin(row.entry.spec, e)}
                          >
                            {livePinned().includes(row.entry.spec) ? "★" : "☆"}
                          </button>
                        </Show>
                        <div class="min-w-0 flex-1">
                          <div class="truncate text-sm text-fg">
                            {row.tier === "follow_default"
                              ? t("modelPicker.followDefault")
                              : row.entry.modelLabel}
                          </div>
                          <Show when={row.tier !== "follow_default"}>
                            <div class="truncate font-mono text-[11px] text-muted">
                              {row.entry.spec}
                            </div>
                          </Show>
                        </div>
                        <Show when={row.entry.badges.length > 0}>
                          <div class="flex shrink-0 flex-wrap justify-end gap-1">
                            <For each={row.entry.badges}>
                              {(b) => (
                                <span class="rounded bg-surface px-1 py-0.5 text-[10px] text-muted">
                                  {b}
                                </span>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </>
                  )}
                </For>

                <Show when={visibleRows().length === 0}>
                  <div class="px-3 py-4 text-center text-sm text-muted">{t("modelPicker.noMatch")}</div>
                </Show>
                <Show when={truncated()}>
                  <div class="px-3 py-2 text-center text-[11px] text-muted">
                    {t("modelPicker.showing", {
                      shown: String(MAX_RENDERED_ROWS),
                      total: String(rows().length),
                    })}
                  </div>
                </Show>
              </div>
            </div>
            {/* click-away */}
            <div class="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          </>
        )}
      </Show>
    </div>
  )
}
