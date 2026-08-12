import type {ToolPermissionDecision} from "@vibefly/uiagent-shared"
import {useCallback, useRef, useState} from "react"

import type {PendingInput, PendingPermission} from "./types"

export function usePermissionFlow() {
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null)
  const [pendingInput, setPendingInput] = useState<PendingInput | null>(null)
  const [inputReply, setInputReply] = useState("")
  const pendingPermissionRef = useRef<PendingPermission | null>(null)
  const pendingInputRef = useRef<PendingInput | null>(null)

  const updatePendingPermission = useCallback((value: PendingPermission | null) => {
    pendingPermissionRef.current = value
    setPendingPermission(value)
  }, [])

  const updatePendingInput = useCallback((value: PendingInput | null) => {
    pendingInputRef.current = value
    setPendingInput(value)
  }, [])

  const respondPermission = useCallback(
    (decision: ToolPermissionDecision) => {
      const pending = pendingPermissionRef.current
      if (!pending) return
      updatePendingPermission(null)
      pending.resolve({requestId: pending.request.requestId, decision})
    },
    [updatePendingPermission],
  )

  const respondInput = useCallback(
    (cancelInput = false) => {
      const pending = pendingInputRef.current
      if (!pending) return
      updatePendingInput(null)
      pending.resolve({
        requestId: pending.request.requestId,
        text: cancelInput ? undefined : inputReply,
        cancelled: cancelInput,
      })
      setInputReply("")
    },
    [inputReply, updatePendingInput],
  )

  const cancelAllPending = useCallback(() => {
    const permission = pendingPermissionRef.current
    if (permission) {
      permission.resolve({requestId: permission.request.requestId, decision: "cancelled"})
      updatePendingPermission(null)
    }
    const input = pendingInputRef.current
    if (input) {
      input.resolve({requestId: input.request.requestId, cancelled: true})
      updatePendingInput(null)
    }
  }, [updatePendingInput, updatePendingPermission])

  return {
    pendingPermission,
    pendingInput,
    inputReply,
    setInputReply,
    pendingPermissionRef,
    pendingInputRef,
    updatePendingPermission,
    updatePendingInput,
    respondPermission,
    respondInput,
    cancelAllPending,
  }
}
