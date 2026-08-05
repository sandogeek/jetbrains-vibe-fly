import {type ComponentProps, createContext, type ReactNode, useContext} from "react"
import {cva} from "class-variance-authority"
import {cn} from "@/lib/utils"

type TextFieldContextValue = {
    value?: string
    onChange?: (value: string) => void
    disabled?: boolean
}

const TextFieldContext = createContext<TextFieldContextValue>({})

type TextFieldProps = Omit<ComponentProps<"div">, "onChange"> & {
    value?: string
    onChange?: (value: string) => void
    disabled?: boolean
    children?: ReactNode
}

function TextField({className, value, onChange, disabled, children, ...props}: TextFieldProps) {
    return (
        <TextFieldContext.Provider value={{value, onChange, disabled}}>
            <div className={cn("mb-3 flex flex-col gap-1", className)} {...props}>
                {children}
            </div>
        </TextFieldContext.Provider>
    )
}

const inputClassName =
    "flex h-9 w-full rounded-md border border-input bg-surface px-2 py-1.5 text-sm text-fg ring-offset-bg file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[invalid]:border-destructive"

type TextFieldInputProps = ComponentProps<"input">

function TextFieldInput({className, value, onChange, disabled, ...props}: TextFieldInputProps) {
    const context = useContext(TextFieldContext)
    const controlledValue = value ?? context.value
    return (
        <input
            className={cn(inputClassName, className)}
            value={controlledValue}
            disabled={disabled ?? context.disabled}
            onChange={(event) => {
                onChange?.(event)
                context.onChange?.(event.currentTarget.value)
            }}
            {...props}
        />
    )
}

function TextFieldTextArea({className, value, onChange, disabled, ...props}: ComponentProps<"textarea">) {
    const context = useContext(TextFieldContext)
    const controlledValue = value ?? context.value
    return (
        <textarea
            className={cn(
                "flex min-h-[80px] w-full rounded-md border border-input bg-surface px-2 py-1.5 font-mono text-xs text-fg ring-offset-bg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                className,
            )}
            value={controlledValue}
            disabled={disabled ?? context.disabled}
            onChange={(event) => {
                onChange?.(event)
                context.onChange?.(event.currentTarget.value)
            }}
            {...props}
        />
    )
}

const labelVariants = cva(
    "text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
    {
        variants: {
            variant: {
                label: "text-muted data-[invalid]:text-destructive",
                description: "font-normal text-muted",
                error: "text-xs text-destructive",
            },
        },
        defaultVariants: {variant: "label"},
    },
)

function TextFieldLabel({className, ...props}: ComponentProps<"label">) {
    return <label className={cn(labelVariants(), className)} {...props} />
}

function TextFieldDescription({className, ...props}: ComponentProps<"div">) {
    return <div className={cn(labelVariants({variant: "description"}), className)} {...props} />
}

function TextFieldErrorMessage({className, ...props}: ComponentProps<"div">) {
    return <div className={cn(labelVariants({variant: "error"}), className)} {...props} />
}

export {
    TextField,
    TextFieldInput,
    TextFieldTextArea,
    TextFieldLabel,
    TextFieldDescription,
    TextFieldErrorMessage,
}
