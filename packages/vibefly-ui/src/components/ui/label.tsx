import type {ComponentProps} from "react"
import {cn} from "@/lib/utils"

function Label({className, ...props}: ComponentProps<"label">) {
    return (
        <label
            className={cn(
                "text-xs font-medium leading-none text-muted peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
                className,
            )}
            {...props}
        />
    )
}

export {Label}
