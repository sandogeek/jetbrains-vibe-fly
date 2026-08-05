import type {ComponentProps, ReactNode} from "react"
import {Dialog as DialogPrimitive} from "radix-ui"
import {X} from "lucide-react"
import {cn} from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger

function DialogContent({
                           className,
                           children,
                           showCloseButton = true,
                           ...props
                       }: ComponentProps<typeof DialogPrimitive.Content> & {
    showCloseButton?: boolean;
    children?: ReactNode
}) {
    return (
        <DialogPrimitive.Portal>
            <div className="fixed inset-0 z-[100] flex items-center justify-center">
                <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/50"/>
                <DialogPrimitive.Content
                    className={cn(
                        "relative z-[101] grid w-full max-w-md gap-3 rounded-lg border border-border bg-bg p-4 shadow-xl",
                        className,
                    )}
                    {...props}
                >
                    {children}
                    {showCloseButton ? (
                        <DialogPrimitive.Close
                            className="absolute right-3 top-3 rounded-sm text-muted opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
                            <X className="size-4"/>
                            <span className="sr-only">Close</span>
                        </DialogPrimitive.Close>
                    ) : null}
                </DialogPrimitive.Content>
            </div>
        </DialogPrimitive.Portal>
    )
}

function DialogHeader({className, ...props}: ComponentProps<"div">) {
    return <div className={cn("flex flex-col space-y-1.5 text-left", className)} {...props} />
}

function DialogFooter({className, ...props}: ComponentProps<"div">) {
    return <div className={cn("flex flex-wrap justify-end gap-2", className)} {...props} />
}

function DialogTitle({className, ...props}: ComponentProps<typeof DialogPrimitive.Title>) {
    return <DialogPrimitive.Title
        className={cn("m-0 text-base font-semibold leading-none tracking-tight text-fg", className)} {...props} />
}

function DialogDescription({className, ...props}: ComponentProps<typeof DialogPrimitive.Description>) {
    return <DialogPrimitive.Description className={cn("m-0 text-sm text-muted", className)} {...props} />
}

export {
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
}
