import type {RecentChatSession, Ui2Agent} from "@vibefly/uiagent-shared"
import {useCallback, useMemo, useRef, useState, type RefObject} from "react"

import {useAppTranslation} from "../i18n"
import type {ChatTab, ThinkingOption} from "./types"

type StateUpdater<T> = T | ((current: T) => T)

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useChatTabs(options: {
  agentRef: RefObject<Ui2Agent | null>
  offlineRef: RefObject<boolean>
  projectRootRef: RefObject<string>
  persistWorkspace: () => Promise<void>
  loadModels: (sessionId: string, force?: boolean) => Promise<void>
  setError: (error: string | null) => void
}) {
  const {agentRef, offlineRef, projectRootRef, persistWorkspace, loadModels, setError} = options
  const {t} = useAppTranslation("chat")
  const [tabs, setTabs] = useState<ChatTab[]>([])
  const [activeId, setActiveId] = useState("")
  const [recent, setRecent] = useState<RecentChatSession[]>([])
  const tabsRef = useRef<ChatTab[]>([])
  const activeIdRef = useRef("")

  const updateTabs = useCallback((update: StateUpdater<ChatTab[]>) => {
    const next = typeof update === "function" ? update(tabsRef.current) : update
    tabsRef.current = next
    setTabs(next)
  }, [])

  const updateActiveId = useCallback((sessionId: string) => {
    activeIdRef.current = sessionId
    setActiveId(sessionId)
  }, [])

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.summary.sessionId === activeId) ?? null,
    [activeId, tabs],
  )

  const thinkingOptions = useMemo<ThinkingOption[]>(
    () => [
      {value: "off", label: t("chat:thinkingOff")},
      {value: "low", label: "Low"},
      {value: "medium", label: "Medium"},
      {value: "high", label: "High"},
      {value: "xhigh", label: "XHigh"},
      {value: "auto", label: "Auto"},
    ],
    [t],
  )

  const busy = ["running", "waiting_permission", "waiting_input"].includes(
    activeTab?.summary.state ?? "",
  )
  const queued = activeTab?.summary.state === "queued"

  const activate = useCallback(
    async (sessionId: string) => {
      updateActiveId(sessionId)
      updateTabs((current) =>
        current.map((tab) =>
          tab.summary.sessionId === sessionId
            ? {...tab, summary: {...tab.summary, unread: false}}
            : tab,
        ),
      )
      await persistWorkspace()
      if (agentRef.current && !offlineRef.current) {
        void agentRef.current.markChatSessionRead(sessionId).catch(() => {})
        await loadModels(sessionId)
      }
    },
    [agentRef, loadModels, offlineRef, persistWorkspace, updateActiveId, updateTabs],
  )

  const newSession = useCallback(async () => {
    if (offlineRef.current) {
      const id = `demo-${Date.now()}`
      const tab: ChatTab = {
        summary: {
          sessionId: id,
          title: t("chat:newSession"),
          state: "idle",
          unread: false,
          updatedAt: Date.now(),
          messageCount: 0,
        },
        messages: [],
      }
      updateTabs((current) => [...current, tab])
      updateActiveId(id)
      return
    }
    if (!agentRef.current) return
    try {
      const snapshot = await agentRef.current.createChatSession({
        projectRoot: projectRootRef.current,
      })
      updateTabs((current) => [...current, snapshot])
      await activate(snapshot.summary.sessionId)
    } catch (createError) {
      setError(errorText(createError))
    }
  }, [activate, agentRef, offlineRef, projectRootRef, setError, t, updateActiveId, updateTabs])

  const closeSession = useCallback(
    async (sessionId: string) => {
      const tab = tabsRef.current.find((item) => item.summary.sessionId === sessionId)
      if (!tab) return
      const running = ["running", "waiting_permission", "waiting_input"].includes(tab.summary.state)
      if (running && !window.confirm(t("chat:closeRunning"))) return
      try {
        if (running && agentRef.current) await agentRef.current.abortChatTurn(sessionId)
        if (agentRef.current && !offlineRef.current) {
          await agentRef.current.releaseChatSession(sessionId)
        }
        let nextTabs = tabsRef.current.filter((item) => item.summary.sessionId !== sessionId)
        updateTabs(nextTabs)
        if (nextTabs.length === 0) {
          await newSession()
          nextTabs = tabsRef.current
        }
        if (activeIdRef.current === sessionId && nextTabs[0]) {
          await activate(nextTabs[0].summary.sessionId)
        }
        void persistWorkspace()
      } catch (closeError) {
        setError(errorText(closeError))
      }
    },
    [activate, agentRef, newSession, offlineRef, persistWorkspace, setError, t, updateTabs],
  )

  const closeOtherSessions = useCallback(
    async (sessionId: string) => {
      const others = tabsRef.current.filter((item) => item.summary.sessionId !== sessionId)
      if (others.length === 0) return
      const hasRunning = others.some((tab) =>
        ["running", "waiting_permission", "waiting_input"].includes(tab.summary.state),
      )
      if (hasRunning && !window.confirm(t("chat:closeOtherRunning"))) return
      try {
        for (const tab of others) {
          const running = ["running", "waiting_permission", "waiting_input"].includes(
            tab.summary.state,
          )
          if (running && agentRef.current) {
            await agentRef.current.abortChatTurn(tab.summary.sessionId)
          }
          if (agentRef.current && !offlineRef.current) {
            await agentRef.current.releaseChatSession(tab.summary.sessionId)
          }
        }
        updateTabs(tabsRef.current.filter((item) => item.summary.sessionId === sessionId))
        if (activeIdRef.current !== sessionId) {
          await activate(sessionId)
        }
        void persistWorkspace()
      } catch (closeError) {
        setError(errorText(closeError))
      }
    },
    [activate, agentRef, offlineRef, persistWorkspace, setError, t, updateTabs],
  )

  const refreshRecent = useCallback(async () => {
    if (!agentRef.current || offlineRef.current) return
    try {
      setRecent(
        await agentRef.current.listRecentChatSessions({
          projectRoot: projectRootRef.current,
        }),
      )
    } catch (recentError) {
      setError(errorText(recentError))
    }
  }, [agentRef, offlineRef, projectRootRef, setError])

  const openRecent = useCallback(
    async (session: RecentChatSession, options?: {replaceSessionId?: string}) => {
      const existing = tabsRef.current.find((tab) => tab.summary.sessionId === session.sessionId)
      try {
        if (existing) {
          await activate(existing.summary.sessionId)
        } else {
          if (!agentRef.current) return
          const snapshot = await agentRef.current.openChatSession({
            projectRoot: projectRootRef.current,
            sessionId: session.sessionId,
            sessionFile: session.sessionFile,
          })
          updateTabs((current) => [...current, snapshot])
          await activate(snapshot.summary.sessionId)
        }
      } catch (openError) {
        setError(errorText(openError))
        return
      }

      const replaceSessionId = options?.replaceSessionId
      if (!replaceSessionId || replaceSessionId === session.sessionId) return
      const sourceTab = tabsRef.current.find((tab) => tab.summary.sessionId === replaceSessionId)
      if (!sourceTab || sourceTab.messages.length > 0 || sourceTab.summary.messageCount > 0) return
      await closeSession(replaceSessionId)
    },
    [activate, agentRef, closeSession, projectRootRef, setError, updateTabs],
  )

  const reorderTabs = useCallback(
    (draggedId: string, targetId: string) => {
      if (!draggedId || draggedId === targetId) return
      updateTabs((current) => {
        const from = current.findIndex((tab) => tab.summary.sessionId === draggedId)
        const to = current.findIndex((tab) => tab.summary.sessionId === targetId)
        if (from < 0 || to < 0) return current
        const reordered = [...current]
        const [moved] = reordered.splice(from, 1)
        reordered.splice(to, 0, moved!)
        return reordered
      })
      void persistWorkspace()
    },
    [persistWorkspace, updateTabs],
  )

  return {
    tabs,
    activeId,
    activeTab,
    recent,
    setRecent,
    thinkingOptions,
    busy,
    queued,
    tabsRef,
    activeIdRef,
    updateTabs,
    updateActiveId,
    activate,
    newSession,
    closeSession,
    closeOtherSessions,
    refreshRecent,
    openRecent,
    reorderTabs,
  }
}
