import {createContext} from "react"

export type ChatMessageActions = {
    onOpenLocation: (path: string, line?: number) => void
    onShowDiff: (path: string) => void
    onRetry?: () => void
}

const noopActions: ChatMessageActions = {
    onOpenLocation: () => undefined,
    onShowDiff: () => undefined,
}

export const ChatMessageActionsContext = createContext<ChatMessageActions>(noopActions)
