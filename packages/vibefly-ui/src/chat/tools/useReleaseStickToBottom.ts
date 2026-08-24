import {useThreadViewportStore} from "@assistant-ui/react"
import {useCallback} from "react"

/** Expanding a tool un-sticks the viewport so auto-scroll does not fight the user. */
export function useReleaseStickToBottom() {
    const store = useThreadViewportStore()
    return useCallback(() => {
        const writable = store as unknown as {
            getState: () => {isAtBottom: boolean}
            setState: (partial: {isAtBottom: boolean}) => void
        }
        if (writable.getState().isAtBottom) {
            writable.setState({isAtBottom: false})
        }
    }, [store])
}
