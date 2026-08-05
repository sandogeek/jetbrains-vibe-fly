/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VIBEFLY_LOG_LEVEL?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

interface Window {
    cefQuery?: (request: {
        request: string
        persistent: boolean
        onSuccess: (response: string) => void
        onFailure: (errorCode: number, errorMessage: string) => void
    }) => number
    cefQueryCancel?: (queryId: number) => void
}
