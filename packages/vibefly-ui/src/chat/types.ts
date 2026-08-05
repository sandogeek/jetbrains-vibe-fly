import type {
    ChatContextItem,
    ChatSessionSnapshot,
    ToolPermissionRequest,
    ToolPermissionResponse,
    UserInputRequest,
    UserInputResponse,
} from "@vibefly/uiagent-shared"

export type ChatTab = ChatSessionSnapshot

export type PendingPermission = {
    request: ToolPermissionRequest
    resolve: (response: ToolPermissionResponse) => void
}

export type PendingInput = {
    request: UserInputRequest
    resolve: (response: UserInputResponse) => void
}

export type ThinkingOption = {
    value: string
    label: string
}

export type ChatContexts = Record<string, ChatContextItem[]>

export const MAX_OPEN_TABS = 8
