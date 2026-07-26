import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { ProviderSnapshot } from "../generated/rpc"
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

export function ModelPicker(props: ModelPickerProps) {
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [providerFilter, setProviderFilter] = createSignal("")
  // Snapshot pin order at open so star toggles don't reshuffle until reopen.
  const [openPinned, setOpenPinned] = createSignal<string[]>([])
  const [openRecent, setOpenRecent] = createSignal<string[]>([])
  const [livePinned, setLivePinned] = createSignal<string[]>([])
  const [liveRecent, setLiveRecent] = createSignal<string[]>([])

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

  createEffect(() => {
    if (open()) {
      setOpenPinned([...(props.pinnedSpecs ?? [])])
      setOpenRecent([...(props.recentSpecs ?? [])])
      setLivePinned([...(props.pinnedSpecs ?? [])])
      setLiveRecent([...(props.recentSpecs ?? [])])
      setQuery("")
      setProviderFilter("")
    }
  })

  const buttonLabel = () => {
    if (!props.value) {
      if (props.allowFollowDefault) return "Follow default model"
      if (props.allowClear) return props.placeholder ?? "No default model"
      return props.placeholder ?? "Select model"
    }
    const entry = selectedEntry()
    if (entry) return displayLabel(entry, Boolean(props.allowFollowDefault))
    return props.value
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

  return (
    <div class="relative w-full">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2 text-left text-sm text-fg hover:border-accent disabled:opacity-50"
        disabled={props.disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span class="truncate font-mono text-xs sm:text-sm">{buttonLabel()}</span>
        <span class="text-muted">▾</span>
      </button>

      <Show when={open()}>
        <div class="absolute z-50 mt-1 w-full min-w-[20rem] rounded border border-border bg-bg shadow-lg">
          <div class="flex flex-col gap-2 border-b border-border p-2">
            <input
              class="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:border-accent"
              placeholder="Search models…"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
            <select
              class="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-fg"
              value={providerFilter()}
              onChange={(e) => setProviderFilter(e.currentTarget.value)}
              title="Limit results to one provider"
            >
              <option value="">All providers</option>
              <For each={providerOptions()}>
                {(p) => <option value={p.id}>{p.label}</option>}
              </For>
            </select>
          </div>

          <div class="max-h-72 overflow-y-auto py-1">
            <Show when={props.allowClear && !props.allowFollowDefault}>
              <button
                type="button"
                class="flex w-full items-center px-3 py-1.5 text-left text-sm text-muted hover:bg-surface"
                onClick={() => select("")}
              >
                No default model
              </button>
            </Show>

            <For each={visibleRows()}>
              {(row) => (
                <>
                  <Show when={row.isFirstInGroup && row.groupLabel}>
                    <div class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {row.groupLabel}
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
                        title={livePinned().includes(row.entry.spec) ? "Unpin" : "Pin"}
                        onClick={(e) => onTogglePin(row.entry.spec, e)}
                      >
                        {livePinned().includes(row.entry.spec) ? "★" : "☆"}
                      </button>
                    </Show>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm text-fg">
                        {row.tier === "follow_default"
                          ? "Follow default model"
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
              <div class="px-3 py-4 text-center text-sm text-muted">No models match</div>
            </Show>
            <Show when={truncated()}>
              <div class="px-3 py-2 text-center text-[11px] text-muted">
                Showing {MAX_RENDERED_ROWS} of {rows().length} models. Refine search to see more.
              </div>
            </Show>
          </div>
        </div>
        {/* click-away */}
        <div class="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      </Show>
    </div>
  )
}
