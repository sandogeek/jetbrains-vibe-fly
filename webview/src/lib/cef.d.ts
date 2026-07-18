export {}

declare global {
  interface Window {
    cefQuery?: (request: {
      request: string
      persistent: boolean
      onSuccess: (response: string) => void
      onFailure: (errorCode: number, errorMessage: string) => void
    }) => number
    cefQueryCancel?: (queryId: number) => void
  }
}
