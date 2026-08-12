import type {ChatContextItem, ChatModelOption, Ui2Agent} from "@vibefly/uiagent-shared"
import {useCallback, useMemo, useRef, useState, type MutableRefObject} from "react"

import type {Ui2HostChat} from "../generated/rpc"
import {log} from "../log"
import type {ModelPickerOption} from "../settings/ModelPicker"
import type {ModelPreferences} from "../settings/settingsStore"
import type {ChatContexts, ChatTab} from "./types"

type StateUpdater<T> = T | ((current: T) => T)

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useChatWorkspace(options: {
  activeId: string
  agentRef: MutableRefObject<Ui2Agent | null>
  offlineRef: MutableRefObject<boolean>
  hostChatRef: MutableRefObject<Ui2HostChat | null>
  hostRef: MutableRefObject<{openExternalUrl: (url: string) => Promise<void> | void} | null>
  tabsRef: MutableRefObject<ChatTab[]>
  activeIdRef: MutableRefObject<string>
  setError: (error: string | null) => void
}) {
  const {
    activeId,
    agentRef,
    offlineRef,
    hostChatRef,
    hostRef,
    tabsRef,
    activeIdRef,
    setError,
  } = options
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [contexts, setContexts] = useState<ChatContexts>({})
  const [models, setModels] = useState<Record<string, ChatModelOption[]>>({})
  const [modelPreferences, setModelPreferences] = useState<ModelPreferences>({
    recentModelSpecs: [],
    pinnedModelSpecs: [],
  })
  const contextsRef = useRef<ChatContexts>({})
  const modelsRef = useRef<Record<string, ChatModelOption[]>>({})
  const modelFetchGenerationRef = useRef<Record<string, number>>({})

  const updateContexts = useCallback((update: StateUpdater<ChatContexts>) => {
    const next = typeof update === "function" ? update(contextsRef.current) : update
    contextsRef.current = next
    setContexts(next)
  }, [])

  const updateModels = useCallback((update: StateUpdater<Record<string, ChatModelOption[]>>) => {
    const next = typeof update === "function" ? update(modelsRef.current) : update
    modelsRef.current = next
    setModels(next)
  }, [])

  const activeContexts = contexts[activeId] ?? []
  const activeDraft = drafts[activeId] ?? ""
  const activeModelOptions = useMemo<ModelPickerOption[]>(
    () =>
      (models[activeId] ?? []).map((option) => ({
        spec: option.id,
        providerId: option.provider,
        modelId: option.model,
        modelLabel: option.label,
        reasoning: option.supportsThinking,
      })),
    [activeId, models],
  )

  const loadModels = useCallback(
    async (sessionId: string, force = false) => {
      const chatAgent = agentRef.current
      if (!chatAgent || (!force && modelsRef.current[sessionId])) return
      const generation = (modelFetchGenerationRef.current[sessionId] ?? 0) + 1
      modelFetchGenerationRef.current[sessionId] = generation
      try {
        const optionsList = await chatAgent.listChatModels(sessionId)
        if (modelFetchGenerationRef.current[sessionId] !== generation) return
        updateModels((current) => ({...current, [sessionId]: optionsList}))
      } catch (modelError) {
        log.debug("model list unavailable", modelError)
      }
    },
    [agentRef, updateModels],
  )

  const appendContexts = useCallback(
    (sessionId: string, incoming: ChatContextItem[]) => {
      if (!sessionId || incoming.length === 0) return
      updateContexts((current) => {
        const existing = current[sessionId] ?? []
        const keys = new Set(
          existing.map(
            (item) => `${item.kind}:${item.path}:${item.startLine ?? ""}:${item.endLine ?? ""}`,
          ),
        )
        const added = incoming.filter((item) => {
          const key = `${item.kind}:${item.path}:${item.startLine ?? ""}:${item.endLine ?? ""}`
          if (!item.path || keys.has(key)) return false
          keys.add(key)
          return true
        })
        return {...current, [sessionId]: [...existing, ...added]}
      })
    },
    [updateContexts],
  )

  const removeContext = useCallback(
    (sessionId: string, contextId: string) => {
      updateContexts((current) => ({
        ...current,
        [sessionId]: (current[sessionId] ?? []).filter((item) => item.id !== contextId),
      }))
    },
    [updateContexts],
  )

  const setDraft = useCallback((sessionId: string, value: string) => {
    setDrafts((current) => ({...current, [sessionId]: value}))
  }, [])

  const persistWorkspace = useCallback(async () => {
    const chatHost = hostChatRef.current
    if (!chatHost || offlineRef.current) return
    try {
      await chatHost.saveChatWorkspaceState({
        sessionIds: tabsRef.current.map((tab) => tab.summary.sessionId),
        activeSessionId: activeIdRef.current,
      })
    } catch (persistError) {
      log.debug("workspace state save failed", persistError)
    }
  }, [activeIdRef, hostChatRef, offlineRef, tabsRef])

  const chooseContextFiles = useCallback(async () => {
    const sessionId = activeIdRef.current
    if (!hostChatRef.current || offlineRef.current || !sessionId) return
    try {
      const relativePaths = await hostChatRef.current.selectChatContextFiles()
      appendContexts(
        sessionId,
        relativePaths.map((relativePath) => ({
          id: crypto.randomUUID(),
          kind: "file",
          path: relativePath,
        })),
      )
    } catch (chooseError) {
      setError(errorText(chooseError))
    }
  }, [activeIdRef, appendContexts, hostChatRef, offlineRef, setError])

  const stopOrCancel = useCallback(
    async (sessionId = activeIdRef.current) => {
      if (!agentRef.current || offlineRef.current || !sessionId) return
      const tab = tabsRef.current.find((item) => item.summary.sessionId === sessionId)
      try {
        if (tab?.summary.state === "queued") {
          await agentRef.current.cancelQueuedTurn(sessionId)
        } else {
          await agentRef.current.abortChatTurn(sessionId)
        }
      } catch (abortError) {
        setError(errorText(abortError))
      }
    },
    [activeIdRef, agentRef, offlineRef, setError, tabsRef],
  )

  const setModel = useCallback(
    async (modelId: string) => {
      if (!agentRef.current || offlineRef.current || !activeIdRef.current) return
      try {
        await agentRef.current.setChatModel(activeIdRef.current, modelId)
      } catch (modelError) {
        setError(errorText(modelError))
      }
    },
    [activeIdRef, agentRef, offlineRef, setError],
  )

  const setThinking = useCallback(
    async (level: string) => {
      if (!agentRef.current || offlineRef.current || !activeIdRef.current) return
      try {
        await agentRef.current.setChatThinkingLevel(activeIdRef.current, level)
      } catch (thinkingError) {
        setError(errorText(thinkingError))
      }
    },
    [activeIdRef, agentRef, offlineRef, setError],
  )

  const openLocation = useCallback(
    (path: string, line?: number) => {
      if (!offlineRef.current) void hostChatRef.current?.openProjectFile(path, line ?? null)
    },
    [hostChatRef, offlineRef],
  )

  const showDiff = useCallback(
    (path: string) => {
      if (!offlineRef.current) void hostChatRef.current?.showProjectDiff(path)
    },
    [hostChatRef, offlineRef],
  )

  const openExternalUrl = useCallback(
    (url: string) => {
      if (!offlineRef.current) void hostRef.current?.openExternalUrl(url)
    },
    [hostRef, offlineRef],
  )

  return {
    drafts,
    contexts,
    models,
    modelPreferences,
    setModelPreferences,
    contextsRef,
    modelsRef,
    updateContexts,
    updateModels,
    activeContexts,
    activeDraft,
    activeModelOptions,
    loadModels,
    appendContexts,
    removeContext,
    setDraft,
    persistWorkspace,
    chooseContextFiles,
    stopOrCancel,
    setModel,
    setThinking,
    openLocation,
    showDiff,
    openExternalUrl,
  }
}
