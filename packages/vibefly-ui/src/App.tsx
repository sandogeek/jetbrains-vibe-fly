import { Switch } from "@ark-ui/solid/switch"

export function App() {
  return (
    <main class="flex min-h-full flex-col items-center justify-center gap-3 p-6">
      <h1 class="m-0 text-4xl font-semibold tracking-wide text-accent">Hello World</h1>
      <p class="m-0 text-sm text-muted">
        Vibe Fly UI · Vite + SolidJS + Ark + Tailwind v4 · <code class="font-mono text-[0.85em]">http://vibefly/</code>
      </p>
      <Switch.Root class="inline-flex cursor-pointer items-center gap-2.5">
        <Switch.Control class="relative h-6 w-10 shrink-0 rounded-full border border-border bg-surface transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent">
          <Switch.Thumb class="absolute top-0.5 left-0.5 size-4 rounded-full bg-fg shadow transition-transform data-[state=checked]:translate-x-5 data-[state=checked]:bg-bg" />
        </Switch.Control>
        <Switch.Context>
          {(api) => (
            <Switch.Label class="text-sm text-fg select-none">
              Ark UI {api().checked ? "on" : "off"}
            </Switch.Label>
          )}
        </Switch.Context>
        <Switch.HiddenInput />
      </Switch.Root>
    </main>
  )
}
