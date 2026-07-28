import { ChevronLeft, Menu } from "lucide-solid"
import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type JSX,
  type ParentProps,
} from "solid-js"
import { cn } from "@/lib/utils"

type SidebarContextValue = {
  open: Accessor<boolean>
  setOpen: (value: boolean) => void
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextValue>()

function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) throw new Error("useSidebar must be used inside SidebarProvider")
  return context
}

export function SidebarProvider(props: ParentProps<{ defaultOpen?: boolean; class?: string }>) {
  const [open, setOpenSignal] = createSignal(props.defaultOpen ?? true)
  const setOpen = (value: boolean) => setOpenSignal(value)
  const toggle = () => setOpenSignal((value) => !value)

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown))
  })

  return (
    <SidebarContext.Provider value={{ open, setOpen, toggle }}>
      <div
        data-state={open() ? "expanded" : "collapsed"}
        class={cn("group/sidebar-wrapper flex min-h-0 w-full flex-1", props.class)}
      >
        {props.children}
      </div>
    </SidebarContext.Provider>
  )
}

export function Sidebar(props: ParentProps<{ class?: string }>) {
  const sidebar = useSidebar()
  return (
    <aside
      data-state={sidebar.open() ? "expanded" : "collapsed"}
      class={cn(
        "relative flex h-full shrink-0 flex-col border-r border-border bg-surface/35 text-fg transition-[width] duration-200 ease-out",
        sidebar.open() ? "w-[268px]" : "w-[58px]",
        props.class,
      )}
    >
      {props.children}
    </aside>
  )
}

export function SidebarHeader(props: ParentProps<{ class?: string }>) {
  return <div class={cn("flex min-h-0 flex-col gap-2 p-3", props.class)}>{props.children}</div>
}

export function SidebarContent(props: ParentProps<{ class?: string }>) {
  return (
    <div class={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3", props.class)}>
      {props.children}
    </div>
  )
}

export function SidebarFooter(props: ParentProps<{ class?: string }>) {
  return <div class={cn("mt-auto flex min-h-0 flex-col gap-2 p-3", props.class)}>{props.children}</div>
}

export function SidebarGroup(props: ParentProps<{ class?: string }>) {
  return <section class={cn("relative flex w-full min-w-0 flex-col p-1", props.class)}>{props.children}</section>
}

export function SidebarGroupLabel(props: ParentProps<{ class?: string }>) {
  const sidebar = useSidebar()
  return (
    <div
      class={cn(
        "flex h-7 shrink-0 items-center rounded px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted transition-[margin,opacity] duration-200",
        !sidebar.open() && "-mt-7 opacity-0",
        props.class,
      )}
    >
      {props.children}
    </div>
  )
}

export function SidebarGroupContent(props: ParentProps<{ class?: string }>) {
  return <div class={cn("w-full text-sm", props.class)}>{props.children}</div>
}

export function SidebarSeparator(props: { class?: string }) {
  return <div role="separator" class={cn("mx-1 my-2 h-px bg-border/80", props.class)} />
}

export function SidebarMenu(props: ParentProps<{ class?: string }>) {
  return <ul class={cn("flex w-full min-w-0 flex-col gap-0.5", props.class)}>{props.children}</ul>
}

export function SidebarMenuItem(props: ParentProps<{ class?: string }>) {
  return <li class={cn("group/menu-item relative min-w-0", props.class)}>{props.children}</li>
}

type SidebarMenuButtonProps = ParentProps<{
  href?: string
  active?: boolean
  disabled?: boolean
  title?: string
  class?: string
  onClick?: JSX.EventHandlerUnion<HTMLElement, MouseEvent>
}>

export function SidebarMenuButton(props: SidebarMenuButtonProps) {
  const sidebar = useSidebar()
  const classes = () =>
    cn(
      "flex h-9 w-full min-w-0 items-center gap-3 overflow-hidden rounded-md px-2.5 text-left text-[13px] font-medium text-muted no-underline outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
      "hover:bg-surface-raised hover:text-fg",
      props.active && "bg-surface-raised text-fg shadow-sm",
      props.disabled && "pointer-events-none opacity-45",
      !sidebar.open() && "justify-center gap-0 px-0",
      props.class,
    )
  const content = () => (
    <>
      <span class="flex size-5 shrink-0 items-center justify-center [&_svg]:size-[17px] [&_svg]:shrink-0">
        {props.children}
      </span>
      <span
        class="min-w-0 flex-1 truncate transition-[opacity,transform] duration-150"
        classList={{ "-translate-x-1 opacity-0": !sidebar.open() }}
      >
        {props.title}
      </span>
    </>
  )

  return (
    <>
      {props.href ? (
        <a
          href={props.href}
          class={classes()}
          title={!sidebar.open() ? props.title : undefined}
          aria-current={props.active ? "page" : undefined}
        >
          {content()}
        </a>
      ) : (
        <button
          type="button"
          class={classes()}
          title={!sidebar.open() ? props.title : undefined}
          disabled={props.disabled}
          onClick={props.onClick}
        >
          {content()}
        </button>
      )}
    </>
  )
}

export function SidebarTrigger(props: { class?: string; label?: string }) {
  const sidebar = useSidebar()
  return (
    <button
      type="button"
      class={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        props.class,
      )}
      aria-label={props.label ?? "Toggle sidebar"}
      title={props.label ?? "Toggle sidebar"}
      onClick={sidebar.toggle}
    >
      {sidebar.open() ? <ChevronLeft class="size-4" /> : <Menu class="size-4" />}
    </button>
  )
}

export function SidebarInset(props: ParentProps<{ class?: string }>) {
  return <main class={cn("min-w-0 flex-1", props.class)}>{props.children}</main>
}

export { useSidebar }
