import { createContext, useContext, useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from "react"
import { ChevronLeft, Menu } from "lucide-react"
import { cn } from "@/lib/utils"

type SidebarContextValue = {
  open: boolean
  setOpen: (value: boolean) => void
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) throw new Error("useSidebar must be used inside SidebarProvider")
  return context
}

function SidebarProvider({ defaultOpen = true, className, children }: { defaultOpen?: boolean; className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
  const value = useMemo(() => ({ open, setOpen, toggle: () => setOpen((current) => !current) }), [open])
  return (
    <SidebarContext.Provider value={value}>
      <div data-state={open ? "expanded" : "collapsed"} className={cn("group/sidebar-wrapper flex min-h-0 w-full flex-1", className)}>{children}</div>
    </SidebarContext.Provider>
  )
}

function Sidebar({ className, children }: { className?: string; children?: ReactNode }) {
  const sidebar = useSidebar()
  return <aside data-state={sidebar.open ? "expanded" : "collapsed"} className={cn("relative flex h-full shrink-0 flex-col border-r border-border bg-surface/35 text-fg transition-[width] duration-200 ease-out", sidebar.open ? "w-[268px]" : "w-[58px]", className)}>{children}</aside>
}

function SidebarHeader({ className, children }: { className?: string; children?: ReactNode }) { return <div className={cn("flex min-h-0 flex-col gap-2 p-3", className)}>{children}</div> }
function SidebarContent({ className, children }: { className?: string; children?: ReactNode }) { return <div className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3", className)}>{children}</div> }
function SidebarFooter({ className, children }: { className?: string; children?: ReactNode }) { return <div className={cn("mt-auto flex min-h-0 flex-col gap-2 p-3", className)}>{children}</div> }
function SidebarGroup({ className, children }: { className?: string; children?: ReactNode }) { return <section className={cn("relative flex w-full min-w-0 flex-col p-1", className)}>{children}</section> }
function SidebarGroupContent({ className, children }: { className?: string; children?: ReactNode }) { return <div className={cn("w-full text-sm", className)}>{children}</div> }
function SidebarGroupLabel({ className, children }: { className?: string; children?: ReactNode }) { const sidebar = useSidebar(); return <div className={cn("flex h-7 shrink-0 items-center rounded px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted transition-[margin,opacity] duration-200", !sidebar.open && "-mt-7 opacity-0", className)}>{children}</div> }
function SidebarSeparator({ className }: { className?: string }) { return <div role="separator" className={cn("mx-1 my-2 h-px bg-border/80", className)} /> }
function SidebarMenu({ className, children }: { className?: string; children?: ReactNode }) { return <ul className={cn("flex w-full min-w-0 flex-col gap-0.5", className)}>{children}</ul> }
function SidebarMenuItem({ className, children }: { className?: string; children?: ReactNode }) { return <li className={cn("group/menu-item relative min-w-0", className)}>{children}</li> }

type SidebarMenuButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; title?: string; href?: string; children?: ReactNode }
function SidebarMenuButton({ active, title, href, className, children, ...props }: SidebarMenuButtonProps) {
  const sidebar = useSidebar()
  const classes = cn("flex h-9 w-full min-w-0 items-center gap-3 overflow-hidden rounded-md px-2.5 text-left text-[13px] font-medium text-muted no-underline outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", "hover:bg-surface-raised hover:text-fg", active && "bg-surface-raised text-fg shadow-sm", !sidebar.open && "justify-center gap-0 px-0", className)
  const content = <><span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-[17px] [&_svg]:shrink-0">{children}</span><span className={cn("min-w-0 flex-1 truncate transition-[opacity,transform] duration-150", !sidebar.open && "-translate-x-1 opacity-0")}>{title}</span></>
  if (href) return <a href={href} className={classes} title={!sidebar.open ? title : undefined} aria-current={active ? "page" : undefined}>{content}</a>
  return <button type="button" className={classes} title={!sidebar.open ? title : undefined} {...props}>{content}</button>
}

function SidebarTrigger({ className, label }: { className?: string; label?: string }) {
  const sidebar = useSidebar()
  return <button type="button" className={cn("inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} aria-label={label ?? "Toggle sidebar"} title={label ?? "Toggle sidebar"} onClick={sidebar.toggle}>{sidebar.open ? <ChevronLeft className="size-4" /> : <Menu className="size-4" />}</button>
}

function SidebarInset({ className, children }: { className?: string; children?: ReactNode }) { return <main className={cn("min-w-0 flex-1", className)}>{children}</main> }

export { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarSeparator, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger, SidebarInset, useSidebar }
