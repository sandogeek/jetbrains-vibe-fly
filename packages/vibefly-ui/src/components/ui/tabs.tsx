import type {ComponentProps} from "react"
import {Tabs as TabsPrimitive} from "radix-ui"
import {cn} from "@/lib/utils"

const Tabs = TabsPrimitive.Root

function TabsList({className, ...props}: ComponentProps<typeof TabsPrimitive.List>) {
    return (
        <TabsPrimitive.List
            className={cn(
                "inline-flex h-9 w-full items-center justify-start gap-1 rounded-md border border-border bg-surface/40 p-1 text-muted",
                className,
            )}
            {...props}
        />
    )
}

function TabsTrigger({className, ...props}: ComponentProps<typeof TabsPrimitive.Trigger>) {
    return (
        <TabsPrimitive.Trigger
            className={cn(
                "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium ring-offset-bg transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:pointer-events-none disabled:opacity-50",
                "data-[state=active]:bg-bg data-[state=active]:text-fg data-[state=active]:shadow-sm",
                className,
            )}
            {...props}
        />
    )
}

function TabsContent({className, ...props}: ComponentProps<typeof TabsPrimitive.Content>) {
    return (
        <TabsPrimitive.Content
            className={cn(
                "mt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                className,
            )}
            {...props}
        />
    )
}

export {Tabs, TabsList, TabsTrigger, TabsContent}
