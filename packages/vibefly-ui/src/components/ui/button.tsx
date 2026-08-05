import type {ButtonHTMLAttributes, ReactNode} from "react"
import type {VariantProps} from "class-variance-authority"
import {cva} from "class-variance-authority"
import {cn} from "@/lib/utils"

const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-bg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    {
        variants: {
            variant: {
                default: "bg-primary text-primary-foreground hover:bg-primary/90",
                destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                outline: "border border-input bg-transparent hover:bg-surface hover:text-fg",
                secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                ghost: "hover:bg-surface hover:text-fg",
                link: "text-primary underline-offset-4 hover:underline",
            },
            size: {
                default: "h-9 px-3 py-1.5",
                sm: "h-8 rounded-md px-2.5 text-xs",
                lg: "h-10 rounded-md px-8",
                icon: "size-9",
            },
        },
        defaultVariants: {variant: "default", size: "default"},
    },
)

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
    VariantProps<typeof buttonVariants> & { children?: ReactNode }

function Button({className, variant, size, ...props}: ButtonProps) {
    return <button className={cn(buttonVariants({variant, size}), className)} {...props} />
}

export {Button, buttonVariants}
export type {ButtonProps}
